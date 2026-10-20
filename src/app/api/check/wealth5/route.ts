import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { isHoneypotTripped, recordBlockedWebinarAttempt } from "@/lib/webinar-honeypot";
import { FORM_THROTTLE_ERROR, reserveCurrentFormAttempt } from "@/lib/form-throttle";
import { normalizeContactPhone, normalizeMobile } from "@/lib/sms/phone";
import { upsertStudent } from "@/lib/student-upsert";
import { buildBroadcastHtml, sendBroadcast } from "@/lib/email/broadcast";
import { getWealth5Links } from "@/lib/wealth5-links";
import {
  WEALTH5_CHECK_SLUG,
  WEALTH5_FORM_KEY,
  WEALTH5_GROUP_NAMES,
  WEALTH5_RESEND_COOLDOWN_MS,
  buildWealth5Answers,
  buildWealth5ReportMail,
  computeWealth5,
  parseWealth5Lead,
} from "@/lib/wealth5-check";

// 五種財富自我檢測：訪客留 Email 換完整報告。
// 流程：蜜罐 → 驗證 → 檢測是否開放 → 限流 → 伺服器重算分數 → 寫名單（WebinarRequest）
//       → 進三個名單群組（全部／分數帶）→ 學員記錄卡 → 寄報告信。
//
// 名單存在 slug=wealth5-check 的 Webinar（素材索取類）底下：後台講座名單頁、CSV 匯出、
// 簡訊「講座索取者」名單、EDM audienceType=WEBINAR 全部現成可用，不另開一張表。
//
// 回應契約（檢測頁 submitLead 依此行為）：
// - 2xx：前端清掉 localStorage 的暫存並展開完整報告
// - 非 2xx 或逾時：前端**仍然展開完整報告**，暫存留著下次開頁重送——所以這裡的錯誤
//   只影響名單有沒有收到，絕不影響使用者看報告；寄信失敗也回 200（名單已存，標 FAILED）。
export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "格式錯誤" }, { status: 400 });
  }
  const fields = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;

  // 蜜罐：真人看不到的欄位有值 = 機器人。裝作成功、留痕供後台查誤殺（與講座表單同一套）
  if (isHoneypotTripped(fields.hp_extra_note)) {
    const blockedEmail = String(fields.email ?? "").trim().toLowerCase();
    console.error("[wealth5] 蜜罐觸發", { email: blockedEmail });
    await recordBlockedWebinarAttempt(WEALTH5_CHECK_SLUG, {
      email: blockedEmail,
      name: String(fields.name ?? ""),
      phone: String(fields.phone ?? ""),
    });
    return NextResponse.json({ ok: true });
  }

  const parsed = parseWealth5Lead(body);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
  const lead = parsed.lead;

  const webinar = await prisma.webinar.findUnique({
    where: { slug: WEALTH5_CHECK_SLUG },
    select: { id: true, title: true, isActive: true, groupId: true },
  });
  if (!webinar || !webinar.isActive)
    return NextResponse.json({ error: "檢測名單尚未開放" }, { status: 503 });

  if (await reserveCurrentFormAttempt(WEALTH5_FORM_KEY))
    return NextResponse.json({ error: FORM_THROTTLE_ERROR }, { status: 429 });

  // 分數一律伺服器重算：名單快照與報告信都用這份，不信任前端送來的 result
  const result = computeWealth5(lead.answers);
  const answers = buildWealth5Answers(lead, result);
  // 手機選填：格式不合轉 null（不該因為手機擋住看報告），海外門號也收
  const phone = lead.phoneRaw ? normalizeContactPhone(lead.phoneRaw) : null;
  const { email, name } = lead;

  // 同信箱 60 秒內重複送出（連點、重送機制）：只更新名單，不重寄
  const existing = await prisma.webinarRequest.findUnique({
    where: { webinarId_email: { webinarId: webinar.id, email } },
    select: { lastSentAt: true, phone: true },
  });
  const shouldSend =
    !existing?.lastSentAt || existing.lastSentAt < new Date(Date.now() - WEALTH5_RESEND_COOLDOWN_MS);

  await prisma.webinarRequest.upsert({
    where: { webinarId_email: { webinarId: webinar.id, email } },
    // 重測以最新作答為準；手機沒填就留舊值
    update: { name, ...(phone ? { phone } : {}), answers },
    create: { webinarId: webinar.id, email, name, phone, answers, sentCount: 0 },
  });

  // 名單群組：講座設定的群組（全部）＋ 分數帶各一組；群組不存在就建（名稱唯一）
  try {
    const groupIds: string[] = [];
    if (webinar.groupId) groupIds.push(webinar.groupId);
    else {
      const all = await prisma.mailGroup.upsert({
        where: { name: WEALTH5_GROUP_NAMES.all },
        update: {},
        create: { name: WEALTH5_GROUP_NAMES.all },
      });
      groupIds.push(all.id);
    }
    const band = await prisma.mailGroup.upsert({
      where: { name: WEALTH5_GROUP_NAMES[result.ctaBand] },
      update: {},
      create: { name: WEALTH5_GROUP_NAMES[result.ctaBand] },
    });
    groupIds.push(band.id);
    for (const groupId of groupIds) {
      await prisma.mailGroupMember.upsert({
        where: { groupId_email: { groupId, email } },
        update: { name },
        create: { groupId, email, name },
      });
    }
  } catch (e) {
    console.error("[wealth5] 名單群組寫入失敗", { email, e });
  }

  // 學員記錄卡：接觸紀錄（不計入上課史），與講座索取同一支 upsertStudent（同行者鐵則只有一份實作）
  try {
    const student = await upsertStudent(normalizeMobile(phone), email, name);
    if (student) {
      const exists = await prisma.studentEngagement.findFirst({
        where: { studentId: student.id, sourceRef: webinar.id },
        select: { id: true },
      });
      if (!exists) {
        await prisma.studentEngagement.create({
          data: {
            studentId: student.id,
            type: "OTHER",
            title: webinar.title,
            occurredAt: new Date(),
            source: "LEAD_CAPTURE",
            sourceRef: webinar.id,
          },
        });
      }
    }
  } catch (e) {
    console.error("[wealth5] 學員記錄卡寫入失敗", { email, e });
  }

  if (shouldSend) {
    const baseUrl = process.env.NEXT_PUBLIC_BASE_URL ?? "https://course.huangxi.info";
    const links = await getWealth5Links();
    const mail = buildWealth5ReportMail(name, result, links, baseUrl);
    const sent = await sendBroadcast(
      [{ email, name }],
      mail.subject,
      () => buildBroadcastHtml(mail.body, null),
      { webinarId: webinar.id },
    );
    const ok = sent.sent > 0;
    if (!ok) console.error("[wealth5] 報告信寄送失敗", { email, error: sent.error });
    await prisma.webinarRequest
      .update({
        where: { webinarId_email: { webinarId: webinar.id, email } },
        data: ok
          ? { sentCount: { increment: 1 }, lastSentAt: new Date(), deliveryStatus: "SENT", deliveryDetail: null, deliveryAt: new Date() }
          : { deliveryStatus: "FAILED", deliveryDetail: (sent.error ?? "寄送失敗").slice(0, 500), deliveryAt: new Date() },
      })
      .catch((e) => console.error("[wealth5] 寄送狀態寫入失敗", { email, e }));
  }

  return NextResponse.json({ ok: true });
}
