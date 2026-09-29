"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { requireEditor } from "@/lib/auth/staff";
import { buildBroadcastHtml, sendBroadcast } from "@/lib/email/broadcast";
import { hasEndedInTaipei } from "@/lib/board-expiry";
import { buildWebinarMail, defaultEmailBody } from "@/lib/webinar-mail";
import {
  dismissBlockedWebinarAttempt,
  HONEYPOT_SUCCESS_MESSAGE,
  isHoneypotTripped,
  recordBlockedWebinarAttempt,
  resendBlockedWebinarAttempt,
} from "@/lib/webinar-honeypot";
import {
  backfillWebinarPhones,
  type BackfillReport,
} from "@/lib/webinar-phone-backfill";
import {
  explainMobile,
  normalizeContactPhone,
  normalizeMobile,
  MOBILE_REJECT_LABEL,
} from "@/lib/sms/phone";
// 學員記錄卡的找／建入口（與訂單匯入共用，同行者鐵則只有一份實作）。
// 海外門號 normalizeMobile 會回 null → upsertStudent 自動退回信箱路徑，正確。
import { upsertStudent } from "@/lib/student-upsert";
import {
  parseSurveyAnswers,
  validateQuestions,
  QUESTION_TYPES,
} from "@/lib/webinar-survey";

// 講座報名頁：後台 CRUD ＋ 訪客索取講座連結信

export type WebinarFormState = { error?: string; success?: string } | null;
// questionId：問卷必填未答時回報是哪一題，前端據此把該題標紅、捲到定位
export type WebinarRequestState =
  | { error?: string; success?: string; questionId?: string }
  | null;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const SLUG_RE = /^[a-z0-9-]+$/;
const RESEND_COOLDOWN_MS = 60 * 1000; // 同 email 重寄限流，防轟炸他人信箱

// 預設信件內文改由 lib/webinar-mail 的 defaultEmailBody(kind) 提供，只能有一份

type AssetInput = { title: string; url: string; note: string | null };
type QuestionInput = { id: string | null; label: string; type: string; options: string[]; required: boolean };

/** 素材清單／問卷由前端編輯器序列化成 JSON 藏在表單裡；壞掉的 JSON 當空清單 */
function readJsonField<T>(formData: FormData, field: string, fallback: T): T {
  try {
    const raw = String(formData.get(field) ?? "");
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

async function parseWebinarForm(formData: FormData) {
  const slug = String(formData.get("slug") ?? "").trim().toLowerCase();
  const title = String(formData.get("title") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim();
  // WEBINAR／RESOURCE：共用同一套流程，只影響文案與欄位顯示。亂值一律當 WEBINAR
  const kindRaw = String(formData.get("kind") ?? "WEBINAR");
  const kind = kindRaw === "RESOURCE" ? "RESOURCE" : "WEBINAR";

  // 素材清單：標題與網址都要有才算一筆；網址須 http(s)
  const assets: AssetInput[] = (readJsonField<unknown>(formData, "assetsJson", []) as unknown[])
    .flatMap((x) => {
      if (!x || typeof x !== "object") return [];
      const o = x as Record<string, unknown>;
      const t = String(o.title ?? "").trim();
      const u = String(o.url ?? "").trim();
      if (!t || !u) return [];
      return [{ title: t.slice(0, 120), url: u, note: String(o.note ?? "").trim().slice(0, 300) || null }];
    });
  for (const a of assets)
    if (!/^https?:\/\//.test(a.url))
      return { error: `素材「${a.title}」的網址須為 http(s) 網址` as const };

  // 問卷題目：上限與題型在 lib 擋（表單可被繞過，不能只擋 UI）
  const questions: QuestionInput[] = (readJsonField<unknown>(formData, "questionsJson", []) as unknown[])
    .flatMap((x) => {
      if (!x || typeof x !== "object") return [];
      const o = x as Record<string, unknown>;
      const label = String(o.label ?? "").trim();
      if (!label) return [];
      const type = String(o.type ?? "SINGLE");
      const options = Array.isArray(o.options)
        ? o.options.map((v) => String(v).trim()).filter(Boolean).slice(0, 20)
        : [];
      return [{
        id: typeof o.id === "string" && o.id ? o.id : null,
        label: label.slice(0, 200),
        type: (QUESTION_TYPES as readonly string[]).includes(type) ? type : "SINGLE",
        options: type === "TEXT" ? [] : options,
        required: o.required === true,
      }];
    });
  const qCheck = validateQuestions(questions);
  if (!qCheck.ok) return { error: qCheck.error as string };

  // 素材索取頁可以只給素材清單、不填單一連結；資料表的 lectureUrl 非空，用第一筆素材補
  let lectureUrl = String(formData.get("lectureUrl") ?? "").trim();
  if (!lectureUrl && kind === "RESOURCE" && assets.length > 0) lectureUrl = assets[0].url;
  const meetingId = String(formData.get("meetingId") ?? "").trim() || null;
  const meetingPassword = String(formData.get("meetingPassword") ?? "").trim() || null;
  const meetingInfo = String(formData.get("meetingInfo") ?? "").trim() || null;
  // DM 圖：瀏覽器已直傳 Storage，這裡只收公開網址字串（同課程封面模式）
  const dmImage = String(formData.get("dmImage") ?? "").trim() || null;
  const emailSubject = String(formData.get("emailSubject") ?? "").trim();
  const emailBody = String(formData.get("emailBody") ?? "").trim() || defaultEmailBody(kind);
  const isActive = formData.get("isActive") === "on";
  const endStr = String(formData.get("endDate") ?? "").trim();
  const endDate = endStr ? new Date(endStr) : null;
  const unpublishRaw = String(formData.get("unpublishAt") ?? "").trim();
  const unpublishAt = unpublishRaw ? new Date(`${unpublishRaw}:00+08:00`) : null;
  if (endDate && Number.isNaN(endDate.getTime()))
    return { error: "結束日期格式錯誤" as const };
  if (unpublishAt && Number.isNaN(unpublishAt.getTime()))
    return { error: "下架時間格式錯誤" as const };

  if (!SLUG_RE.test(slug)) return { error: "網址代稱只能用小寫英數與連字號（例：ai-webinar-0815）" as const };
  if (!title) return { error: "請填寫標題" as const };
  if (!/^https?:\/\//.test(lectureUrl))
    return {
      error: (kind === "RESOURCE"
        ? "請至少加一筆素材（或填一個 http(s) 連結）"
        : "講座連結須為 http(s) 網址") as string,
    };
  if (dmImage && !/^https?:\/\//.test(dmImage)) return { error: "DM 圖網址格式錯誤" as const };
  if (!emailSubject) return { error: "請填寫信件主旨" as const };

  // 名單群組：填了新群組名稱就建立（或沿用同名既有群組）並優先使用
  const newGroupName = String(formData.get("newGroupName") ?? "").trim();
  let groupId = String(formData.get("groupId") ?? "").trim() || null;
  if (newGroupName) {
    const group = await prisma.mailGroup.upsert({
      where: { name: newGroupName },
      update: {},
      create: { name: newGroupName },
    });
    groupId = group.id;
  }

  return {
    assets,
    questions,
    data: {
    kind,
    slug,
    title,
    description,
    lectureUrl,
    meetingId,
    meetingPassword,
    meetingInfo,
    dmImage,
    emailSubject,
    emailBody,
    groupId,
    isActive,
    endDate,
    unpublishAt,
    },
  };
}

/** 素材與問卷的同步。
 *  素材沒有任何東西引用它，整批替換最簡單也最不會出錯。
 *  問卷**不可硬刪**：已收到的答案要保留題目脈絡——表單裡沒出現的舊題目改成 isActive=false，
 *  出現的依 id 更新，沒 id 的新建。 */
async function syncWebinarRelations(
  webinarId: string,
  assets: AssetInput[],
  questions: QuestionInput[],
) {
  await prisma.$transaction(async (tx) => {
    await tx.webinarAsset.deleteMany({ where: { webinarId } });
    if (assets.length > 0)
      await tx.webinarAsset.createMany({
        data: assets.map((a, i) => ({ webinarId, title: a.title, url: a.url, note: a.note, sortOrder: i })),
      });

    const keepIds = questions.map((q) => q.id).filter((id): id is string => !!id);
    await tx.webinarQuestion.updateMany({
      where: { webinarId, isActive: true, ...(keepIds.length ? { id: { notIn: keepIds } } : {}) },
      data: { isActive: false },
    });
    for (const [i, q] of questions.entries()) {
      const data = { label: q.label, type: q.type, options: q.options, required: q.required, sortOrder: i, isActive: true };
      if (q.id) {
        // 只更新屬於這個頁面的題目：id 是公開表單送上來的，不能信任
        await tx.webinarQuestion.updateMany({ where: { id: q.id, webinarId }, data });
      } else {
        await tx.webinarQuestion.create({ data: { webinarId, ...data } });
      }
    }
  });
}

export async function createWebinarAction(
  _prev: WebinarFormState,
  formData: FormData,
): Promise<WebinarFormState> {
  await requireEditor();
  const parsed = await parseWebinarForm(formData);
  if ("error" in parsed) return { error: parsed.error };
  let created: { id: string };
  try {
    created = await prisma.webinar.create({ data: parsed.data, select: { id: true } });
  } catch {
    return { error: `網址代稱「${parsed.data.slug}」已被使用` };
  }
  await syncWebinarRelations(created.id, parsed.assets, parsed.questions);
  revalidatePath("/admin/webinars");
  revalidatePath("/");
  revalidatePath("/board");
  // 建立成功直接回場次列表（新場次排最上面），建立頁只負責建立
  redirect("/admin/webinars");
}

export async function updateWebinarAction(
  id: string,
  _prev: WebinarFormState,
  formData: FormData,
): Promise<WebinarFormState> {
  await requireEditor();
  const parsed = await parseWebinarForm(formData);
  if ("error" in parsed) return { error: parsed.error };
  try {
    await prisma.webinar.update({ where: { id }, data: parsed.data });
    await syncWebinarRelations(id, parsed.assets, parsed.questions);
  } catch {
    return { error: `網址代稱「${parsed.data.slug}」已被使用` };
  }
  revalidatePath("/admin/webinars");
  revalidatePath(`/webinar/${parsed.data.slug}`);
  revalidatePath("/");
  revalidatePath("/board");
  return { success: "已更新" };
}

/** 刪除講座頁（連同索取紀錄，客戶端先 confirm） */
export async function deleteWebinarAction(id: string) {
  await requireEditor();
  await prisma.webinar.delete({ where: { id } }).catch(() => undefined);
  revalidatePath("/admin/webinars");
  revalidatePath("/");
  revalidatePath("/board");
}

/** 管理員編輯索取紀錄（姓名/email 打錯修正） */
export async function updateWebinarRequestAction(
  id: string,
  _prev: WebinarFormState,
  formData: FormData,
): Promise<WebinarFormState> {
  await requireEditor();
  const name = String(formData.get("name") ?? "").trim() || null;
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  if (!EMAIL_RE.test(email)) return { error: "Email 格式錯誤" };
  // 後台修正手機：這裡允許清空（上線前的舊紀錄本來就沒有號碼，不能逼管理員亂編一個）
  const phoneRaw = String(formData.get("phone") ?? "").trim();
  const phone = phoneRaw ? normalizeContactPhone(phoneRaw) : null;
  if (phoneRaw && !phone) {
    const reject = explainMobile(phoneRaw).reject ?? "FORMAT";
    return { error: `手機號碼${MOBILE_REJECT_LABEL[reject]}` };
  }
  try {
    await prisma.webinarRequest.update({ where: { id }, data: { name, email, phone } });
  } catch {
    return { error: `${email} 已在這個講座的索取名單裡` };
  }
  revalidatePath("/admin/webinars");
  revalidatePath("/board");
  return { success: "已更新" };
}

/** 管理員移除索取紀錄（客戶端先 confirm；不影響已加入的名單群組） */
export async function deleteWebinarRequestAction(id: string) {
  await requireEditor();
  await prisma.webinarRequest.delete({ where: { id } }).catch(() => undefined);
  revalidatePath("/admin/webinars");
  revalidatePath("/board");
}

/** 從會員資料補齊索取名單的手機（姓名吻合才寫，其餘列出讓管理員決定）。
 *  回傳整份報告——「補了幾筆」不夠，操作者必須看到「哪幾筆不敢補、為什麼」。 */
export async function backfillWebinarPhonesAction(
  webinarId: string,
): Promise<BackfillReport> {
  await requireEditor();
  const report = await backfillWebinarPhones(webinarId, { apply: true });
  revalidatePath("/admin/webinars");
  revalidatePath("/admin/sessions");
  revalidatePath("/admin/sms");
  return report;
}

/** 補寄給被蜜罐擋下的人（薄殼：權限＋快取失效，邏輯在 lib/webinar-honeypot）。
 *
 *  做成後台一鍵而不是叫對方「回登記頁再送一次」——同一台裝置、同一個密碼管理器，
 *  他很可能再被擋一次，而且他已經看過一次「已寄出」，再叫他重送很難交代。 */
export async function resendBlockedWebinarAttemptAction(
  attemptId: string,
): Promise<WebinarFormState> {
  await requireEditor();
  const result = await resendBlockedWebinarAttempt(attemptId);
  revalidatePath("/admin/webinars");
  revalidatePath("/admin/sessions");
  revalidatePath("/board");
  return result;
}

/** 確認為機器人：不寄信，只把紀錄結案（後台預設只列未處理的，免得越積越長） */
export async function dismissBlockedWebinarAttemptAction(attemptId: string) {
  await requireEditor();
  await dismissBlockedWebinarAttempt(attemptId);
  revalidatePath("/admin/webinars");
  revalidatePath("/admin/sessions");
}

/** 訪客索取講座連結：驗證 → 限流 → 記錄 → 進名單群組 → 寄信 */
export async function requestWebinarLinkAction(
  slug: string,
  _prev: WebinarRequestState,
  formData: FormData,
): Promise<WebinarRequestState> {
  // 蜜罐：真人看不到的欄位有值 = 機器人，裝作成功不寄信。
  // 欄位名刻意用 autofill 字典外的怪名，且設 readOnly、排在表單最後——
  // 密碼管理器不寫入 readOnly 欄位，用腳本塞 value 的機器人照樣會中。
  //
  // **但誤殺一定還是會發生，所以這裡必須留下痕跡。** 以前只寫一行 console.error
  // 就回「已寄出」，而 Vercel runtime log 保存期短到事後查不回來：被吞掉的真人
  // 在資料庫、Resend、後台全部查無此人，只能靠刪去法推定（2026-09-03 fly.eagle、
  // 2026-09-08 emilychi07 兩起都是這樣，後者是本人傳了成功截圖才確認得了）。
  // 寫進 WebinarBlockedAttempt 之後，後台看得到、一鍵補寄得回來。
  //
  // 回應仍然假裝成功：告訴機器人「你被擋了」等於教它怎麼繞過。
  if (isHoneypotTripped(formData.get("hp_extra_note"))) {
    const blockedEmail = String(formData.get("email") ?? "").trim().toLowerCase();
    console.error("[webinar] 蜜罐觸發（機器人或 autofill 誤填）", { slug, email: blockedEmail });
    // 絕不 throw、絕不影響回應：這是防機器人路徑（實作與失敗處理都在 lib）
    await recordBlockedWebinarAttempt(slug, {
      email: blockedEmail,
      name: String(formData.get("name") ?? ""),
      phone: String(formData.get("phone") ?? ""),
    });
    return { success: HONEYPOT_SUCCESS_MESSAGE };
  }

  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const name = String(formData.get("name") ?? "").trim();
  if (!name) return { error: "請填寫姓名" };
  if (!EMAIL_RE.test(email)) return { error: "Email 格式不正確，請再確認" };

  // 手機必填（2026-09-02 Jason 決定）：開課前提醒簡訊與學員記錄卡歸戶都以手機為識別鍵。
  // 用 normalizeContactPhone 而非 normalizeMobile——海外門號（+60…）是有效聯絡方式，
  // 只是不發國際簡訊，不該把人擋在報名門外。錯誤訊息帶原因（市話／少一碼…比「格式錯誤」有用）。
  const phoneRaw = String(formData.get("phone") ?? "").trim();
  const phone = normalizeContactPhone(phoneRaw);
  if (!phone) {
    const reject = explainMobile(phoneRaw).reject ?? "FORMAT";
    return {
      error:
        reject === "EMPTY"
          ? "請填寫手機號碼"
          : `手機號碼${MOBILE_REJECT_LABEL[reject]}，請再確認`,
    };
  }

  const webinar = await prisma.webinar.findUnique({
    where: { slug },
    include: {
      assets: { orderBy: { sortOrder: "asc" } },
      questions: { where: { isActive: true }, orderBy: { sortOrder: "asc" } },
    },
  });
  if (!webinar || !webinar.isActive || hasEndedInTaipei(webinar.endDate) ||
    (!!webinar.unpublishAt && webinar.unpublishAt <= new Date()))
    return { error: "此講座報名已結束" };

  // 問卷：必填未答要在寄信之前擋下，訪客改完再送。
  // 選項值只收在題目選項內的（公開端點，前端擋不住竄改）。
  const survey = parseSurveyAnswers(webinar.questions, (field) =>
    formData.getAll(field).map((v) => String(v)),
  );
  if (!survey.ok) return { error: survey.error, questionId: survey.questionId };

  // 同 email 60 秒限流：防止被拿來重複轟炸別人的信箱
  const existing = await prisma.webinarRequest.findUnique({
    where: { webinarId_email: { webinarId: webinar.id, email } },
  });
  if (
    existing?.lastSentAt &&
    Date.now() - existing.lastSentAt.getTime() < RESEND_COOLDOWN_MS
  ) {
    return {
      success: "確認信剛剛已寄出，請稍候並到信箱查收（也請檢查垃圾郵件夾）",
    };
  }

  // 信件內容組裝抽在 lib/webinar-mail：後台預覽頁走同一支，兩邊不會各說各話。
  // （{name}/{email} 合併變數先替換再轉 HTML，esc 在 buildBroadcastHtml 內處理防注入）
  const { subject, body } = buildWebinarMail(webinar, { email, name });

  // 帶 webinar_id tag：Resend webhook 事件回流 → 更新這筆索取的寄送狀態
  const result = await sendBroadcast(
    [{ email, name }],
    subject,
    () => buildBroadcastHtml(body, null),
    { webinarId: webinar.id },
  );
  if (result.sent === 0) {
    console.error("[webinar] 寄信失敗", { slug, email, error: result.error });
    // 寄失敗也留下索取紀錄（名單不能丟）標 FAILED；不動 lastSentAt，訪客可立即重試
    await prisma.webinarRequest
      .upsert({
        where: { webinarId_email: { webinarId: webinar.id, email } },
        update: {
          name,
          phone,
          deliveryStatus: "FAILED",
          deliveryDetail: (result.error ?? "寄送失敗").slice(0, 500),
          deliveryAt: new Date(),
        },
        create: {
          webinarId: webinar.id,
          email,
          name,
          phone,
          deliveryStatus: "FAILED",
          deliveryDetail: (result.error ?? "寄送失敗").slice(0, 500),
          deliveryAt: new Date(),
        },
      })
      .catch((e) => console.error("[webinar] FAILED 紀錄寫入失敗", { slug, email, e }));
    return { error: "寄送失敗，請稍後再試；若持續失敗請聯繫我們" };
  }

  // 記錄索取（冪等）＋ 加入名單群組；兩者失敗都不影響「信已寄出」的結果
  try {
    await prisma.webinarRequest.upsert({
      where: { webinarId_email: { webinarId: webinar.id, email } },
      update: {
        name,
        phone,
        // 重送時以最新一次作答為準；沒作答（例如既有講座頁沒有問卷）就不動舊值
        ...(survey.answers.length > 0 ? { answers: survey.answers } : {}),
        sentCount: { increment: 1 },
        lastSentAt: new Date(),
        // 重寄 = 新一輪追蹤：狀態重置回 SENT，等 webhook 回報這一封的下場
        deliveryStatus: "SENT",
        deliveryDetail: null,
        deliveryAt: new Date(),
      },
      create: {
        webinarId: webinar.id,
        email,
        name,
        phone,
        answers: survey.answers.length > 0 ? survey.answers : undefined,
        sentCount: 1,
        lastSentAt: new Date(),
        deliveryStatus: "SENT",
        deliveryAt: new Date(),
      },
    });
    if (webinar.groupId) {
      await prisma.mailGroupMember.upsert({
        where: { groupId_email: { groupId: webinar.groupId, email } },
        update: { name },
        create: { groupId: webinar.groupId, email, name },
      });
    }
  } catch (e) {
    console.error("[webinar] 索取紀錄/名單寫入失敗", { slug, email, e });
  }

  // 學員記錄卡：索取者也是潛在名單，進卡之後才算得出「索取 → 報名正式課程」的轉換。
  // 走與訂單匯入同一支 upsertStudent，同行者鐵則（姓名不同＝不同人）只能有一份實作。
  // 整段包在 try 裡：記錄卡寫失敗絕不能讓已經寄出的信變成「失敗」。
  try {
    const student = await upsertStudent(normalizeMobile(phone), email, name);
    if (student) {
      // 接觸紀錄不是上課史，不得計入「上過幾堂課」
      const exists = await prisma.studentEngagement.findFirst({
        where: { studentId: student.id, sourceRef: webinar.id },
        select: { id: true },
      });
      if (!exists) {
        await prisma.studentEngagement.create({
          data: {
            studentId: student.id,
            type: webinar.kind === "RESOURCE" ? "OTHER" : "SEMINAR",
            title: webinar.title,
            occurredAt: new Date(),
            source: "LEAD_CAPTURE",
            sourceRef: webinar.id,
          },
        });
      }
    }
  } catch (e) {
    console.error("[webinar] 學員記錄卡寫入失敗（不影響寄信）", { slug, email, e });
  }

  return { success: "確認信已寄出，請到信箱查收（也請檢查垃圾郵件夾）！" };
}

export type WebinarDeliveryStatus =
  | "PENDING" // 已寄出，還沒收到 webhook 回報
  | "DELIVERED" // 已送達對方信箱服務商（含已開信/點擊）
  | "BOUNCED" // 退信（地址不存在或被拒收）
  | "FAILED" // 寄送失敗（API 層）
  | null; // 查不到或超出查詢時窗

const STATUS_QUERY_WINDOW_MS = 15 * 60 * 1000;

/** 報名成功頁輪詢寄送狀態：退信/失敗即時提示訪客改地址。
 *  公開端點防列舉：只回報「最近 15 分鐘內有寄送動作」的紀錄，其餘一律 null。 */
export async function getWebinarDeliveryStatusAction(
  slug: string,
  email: string,
): Promise<WebinarDeliveryStatus> {
  const normalized = email.trim().toLowerCase();
  if (!EMAIL_RE.test(normalized)) return null;
  const webinar = await prisma.webinar.findUnique({
    where: { slug },
    select: { id: true },
  });
  if (!webinar) return null;
  const req = await prisma.webinarRequest.findUnique({
    where: { webinarId_email: { webinarId: webinar.id, email: normalized } },
    select: { deliveryStatus: true, lastSentAt: true, deliveryAt: true },
  });
  if (!req) return null;
  const lastActivity = Math.max(
    req.lastSentAt?.getTime() ?? 0,
    req.deliveryAt?.getTime() ?? 0,
  );
  if (Date.now() - lastActivity > STATUS_QUERY_WINDOW_MS) return null;
  switch (req.deliveryStatus) {
    case "DELIVERED":
    case "OPENED":
    case "CLICKED":
      return "DELIVERED";
    case "BOUNCED":
    case "COMPLAINED":
      return "BOUNCED";
    case "FAILED":
      return "FAILED";
    case "SENT":
      return "PENDING";
    default:
      return null;
  }
}
