"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { requireEditor } from "@/lib/auth/staff";
import { buildBroadcastHtml, sendBroadcast } from "@/lib/email/broadcast";
import { hasEndedInTaipei } from "@/lib/board-expiry";
import { buildWebinarMail } from "@/lib/webinar-mail";
import { explainMobile, normalizeContactPhone, MOBILE_REJECT_LABEL } from "@/lib/sms/phone";

// 講座報名頁：後台 CRUD ＋ 訪客索取講座連結信

export type WebinarFormState = { error?: string; success?: string } | null;
export type WebinarRequestState = { error?: string; success?: string } | null;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const SLUG_RE = /^[a-z0-9-]+$/;
const RESEND_COOLDOWN_MS = 60 * 1000; // 同 email 重寄限流，防轟炸他人信箱

const DEFAULT_EMAIL_BODY = `您好，感謝索取講座連結！

點擊下方按鈕即可進入講座：

[▶️ 進入講座]({link})

若按鈕無法點擊，請直接開啟：{link}

希望學院 敬上`;

async function parseWebinarForm(formData: FormData) {
  const slug = String(formData.get("slug") ?? "").trim().toLowerCase();
  const title = String(formData.get("title") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim();
  const lectureUrl = String(formData.get("lectureUrl") ?? "").trim();
  const meetingId = String(formData.get("meetingId") ?? "").trim() || null;
  const meetingPassword = String(formData.get("meetingPassword") ?? "").trim() || null;
  const meetingInfo = String(formData.get("meetingInfo") ?? "").trim() || null;
  // DM 圖：瀏覽器已直傳 Storage，這裡只收公開網址字串（同課程封面模式）
  const dmImage = String(formData.get("dmImage") ?? "").trim() || null;
  const emailSubject = String(formData.get("emailSubject") ?? "").trim();
  const emailBody = String(formData.get("emailBody") ?? "").trim() || DEFAULT_EMAIL_BODY;
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
  if (!title) return { error: "請填寫講座標題" as const };
  if (!/^https?:\/\//.test(lectureUrl)) return { error: "講座連結須為 http(s) 網址" as const };
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
  };
}

export async function createWebinarAction(
  _prev: WebinarFormState,
  formData: FormData,
): Promise<WebinarFormState> {
  await requireEditor();
  const parsed = await parseWebinarForm(formData);
  if ("error" in parsed) return { error: parsed.error };
  try {
    await prisma.webinar.create({ data: parsed });
  } catch {
    return { error: `網址代稱「${parsed.slug}」已被使用` };
  }
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
    await prisma.webinar.update({ where: { id }, data: parsed });
  } catch {
    return { error: `網址代稱「${parsed.slug}」已被使用` };
  }
  revalidatePath("/admin/webinars");
  revalidatePath(`/webinar/${parsed.slug}`);
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

/** 訪客索取講座連結：驗證 → 限流 → 記錄 → 進名單群組 → 寄信 */
export async function requestWebinarLinkAction(
  slug: string,
  _prev: WebinarRequestState,
  formData: FormData,
): Promise<WebinarRequestState> {
  // 蜜罐：真人看不到的欄位有值 = 機器人，裝作成功不寄信。
  // 欄位名刻意用 autofill 字典外的怪名（曾因取名 website 被瀏覽器自動填入而誤殺真人）；
  // 觸發時記 log，之後查「沒收到信」先看這裡。
  if (String(formData.get("hp_extra_note") ?? "").trim() !== "") {
    console.error("[webinar] 蜜罐觸發（機器人或 autofill 誤填）", {
      slug,
      email: String(formData.get("email") ?? ""),
    });
    return { success: "確認信已寄出，請到信箱查收！" };
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

  const webinar = await prisma.webinar.findUnique({ where: { slug } });
  if (!webinar || !webinar.isActive || hasEndedInTaipei(webinar.endDate) ||
    (!!webinar.unpublishAt && webinar.unpublishAt <= new Date()))
    return { error: "此講座報名已結束" };

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
