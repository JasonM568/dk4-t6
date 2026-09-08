import "server-only";

import { prisma } from "@/lib/db";
import { buildBroadcastHtml, sendBroadcast } from "@/lib/email/broadcast";
import { buildWebinarMail } from "@/lib/webinar-mail";

// 蜜罐擋下的講座索取：記錄與補救。
//
// 抽成 lib 而不是留在 "use server" 檔案裡，理由與 webinar-mail.ts 相同——
// actions/webinar.ts 匯入了 next/navigation，測試一 import 就炸在 React context 上，
// 於是這條路徑過去從來沒有被測過。而它正是**吞掉真人報名**的那條路徑
// （2026-09-03、2026-09-08 各一起），最不該是唯一沒有測試的地方。

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** 蜜罐擋下時回給前端的訊息。
 *
 *  刻意與正常寄出的訊息**不同字**（正常那句尾巴有「（也請檢查垃圾郵件夾）」）：
 *  成功畫面是 `✅ {state.success}` 原字串直接印出去，所以只要對方傳一張截圖，
 *  這一句就能分辨他走的是哪條路——2026-09-08 那起就是靠這個確認的。
 *  改字前先想清楚會不會讓那個線索消失。 */
export const HONEYPOT_SUCCESS_MESSAGE = "確認信已寄出，請到信箱查收！";

/** 隱藏欄位有沒有被填。空白字元不算——有些瀏覽器/擴充套件會塞空字串或空白進去，
 *  那不是機器人，把空白當觸發就是自己製造誤殺。 */
export function isHoneypotTripped(raw: unknown): boolean {
  return String(raw ?? "").trim() !== "";
}

/** 蜜罐觸發時留痕。
 *
 *  以前這裡只有一行 console.error，而 Vercel runtime log 的保存期短到事後查不回來：
 *  被誤殺的人在資料庫、Resend、後台三邊都查無此人，只能靠刪去法推定。
 *
 *  刻意不寫進 WebinarRequest：那是「名單」，會被看板、索取人數與 EDM／簡訊的
 *  audienceType=WEBINAR 一起吃進去。把疑似機器人混進正式名單，
 *  是拿名單的乾淨度去換診斷能力。
 *
 *  絕不 throw：這是防機器人路徑，任何額外的失敗點都不該讓它變慢或報錯。 */
export async function recordBlockedWebinarAttempt(
  slug: string,
  fields: { email?: string | null; name?: string | null; phone?: string | null },
): Promise<void> {
  try {
    const webinar = await prisma.webinar.findUnique({
      where: { slug },
      select: { id: true },
    });
    if (!webinar) return;
    await prisma.webinarBlockedAttempt.create({
      data: {
        webinarId: webinar.id,
        email: fields.email?.trim().toLowerCase() || null,
        name: fields.name?.trim() || null,
        phone: fields.phone?.trim() || null,
        reason: "HONEYPOT",
      },
    });
  } catch (e) {
    console.error("[webinar] 蜜罐紀錄寫入失敗", { slug, e });
  }
}

export type BlockedResendResult = { error?: string; success?: string };

/** 補寄給被誤殺的人：寄出與正常登記**完全相同**的信，並補進索取名單。
 *
 *  順序是「寄成功了才寫名單、才結案」。反過來的話，寄送失敗會留下一筆
 *  看起來已經通知過的名單，那個人就第二次無聲消失了——這條路徑存在的意義
 *  就是不要再發生那件事。 */
export async function resendBlockedWebinarAttempt(
  attemptId: string,
): Promise<BlockedResendResult> {
  const attempt = await prisma.webinarBlockedAttempt.findUnique({
    where: { id: attemptId },
    include: { webinar: true },
  });
  if (!attempt) return { error: "找不到這筆紀錄（可能已處理或已刪除）" };
  if (attempt.resolvedAt) return { error: "這筆已經處理過了" };

  const email = attempt.email?.trim().toLowerCase() ?? "";
  if (!EMAIL_RE.test(email))
    return { error: "這筆沒有可用的 Email（多半真的是機器人），無法補寄" };

  const name = attempt.name?.trim() || "";
  const { subject, body } = buildWebinarMail(attempt.webinar, { email, name });
  const result = await sendBroadcast(
    [{ email, name: name || undefined }],
    subject,
    () => buildBroadcastHtml(body, null),
    { webinarId: attempt.webinarId },
  );
  if (result.sent === 0)
    return { error: `寄送失敗：${result.error ?? "未知錯誤"}（未結案，可再試）` };

  // upsert：對方若在這之間自己重登記成功了，不會撞 unique 也不會蓋掉他的資料
  await prisma.webinarRequest.upsert({
    where: { webinarId_email: { webinarId: attempt.webinarId, email } },
    update: {
      ...(name ? { name } : {}),
      ...(attempt.phone ? { phone: attempt.phone } : {}),
      sentCount: { increment: 1 },
      lastSentAt: new Date(),
      deliveryStatus: "SENT",
      deliveryDetail: null,
      deliveryAt: new Date(),
    },
    create: {
      webinarId: attempt.webinarId,
      email,
      name: name || null,
      phone: attempt.phone,
      sentCount: 1,
      lastSentAt: new Date(),
      deliveryStatus: "SENT",
      deliveryAt: new Date(),
    },
  });
  if (attempt.webinar.groupId) {
    await prisma.mailGroupMember.upsert({
      where: { groupId_email: { groupId: attempt.webinar.groupId, email } },
      update: name ? { name } : {},
      create: { groupId: attempt.webinar.groupId, email, name: name || null },
    });
  }
  await prisma.webinarBlockedAttempt.update({
    where: { id: attemptId },
    data: { resolvedAt: new Date() },
  });
  return { success: `已補寄給 ${email}，並補進索取名單` };
}

/** 確認為機器人：只結案，不寄信、不進名單 */
export async function dismissBlockedWebinarAttempt(attemptId: string): Promise<void> {
  await prisma.webinarBlockedAttempt
    .update({ where: { id: attemptId }, data: { resolvedAt: new Date() } })
    .catch(() => undefined);
}
