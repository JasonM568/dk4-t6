"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requireEditor } from "@/lib/auth/staff";
import { buildBroadcastHtml, sendBroadcast } from "@/lib/email/broadcast";

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
  };
}

// 進會議連結：有密碼且連結本身沒帶 pwd 參數時，自動附加 ?pwd=（Zoom 慣例）。
// 若 Zoom 邀請連結原本就含加密 pwd，直接沿用不動。
// （"use server" 檔案只允許 export async 函式，此為模組內部工具）
function buildJoinUrl(lectureUrl: string, meetingPassword: string | null): string {
  if (!meetingPassword) return lectureUrl;
  try {
    const url = new URL(lectureUrl);
    if (url.searchParams.has("pwd")) return lectureUrl;
    url.searchParams.set("pwd", meetingPassword);
    return url.toString();
  } catch {
    return lectureUrl;
  }
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
  return { success: `已建立講座頁：/webinar/${parsed.slug}` };
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
  return { success: "已更新" };
}

/** 刪除講座頁（連同索取紀錄，客戶端先 confirm） */
export async function deleteWebinarAction(id: string) {
  await requireEditor();
  await prisma.webinar.delete({ where: { id } }).catch(() => undefined);
  revalidatePath("/admin/webinars");
}

/** 訪客索取講座連結：驗證 → 限流 → 記錄 → 進名單群組 → 寄信 */
export async function requestWebinarLinkAction(
  slug: string,
  _prev: WebinarRequestState,
  formData: FormData,
): Promise<WebinarRequestState> {
  // 蜜罐：真人看不到的欄位有值 = 機器人，裝作成功不寄信
  if (String(formData.get("website") ?? "").trim() !== "")
    return { success: "確認信已寄出，請到信箱查收！" };

  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  if (!EMAIL_RE.test(email)) return { error: "Email 格式不正確，請再確認" };

  const webinar = await prisma.webinar.findUnique({ where: { slug } });
  if (!webinar || !webinar.isActive)
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

  // 信件內文：{link} 換成「帶密碼的進會議連結」；內文沒提到連結就自動補 CTA 按鈕
  const joinUrl = buildJoinUrl(webinar.lectureUrl, webinar.meetingPassword);
  let body = webinar.emailBody;
  if (!body.includes("{link}") && !body.includes(webinar.lectureUrl)) {
    body += `\n\n[▶️ 進入講座]({link})`;
  }
  body = body.replaceAll("{link}", joinUrl);

  // 信末附完整會議資訊區塊（點連結失敗時可手動輸入 ID/密碼）
  const infoLines = [
    webinar.meetingId && `會議 ID：${webinar.meetingId}`,
    webinar.meetingPassword && `會議密碼：${webinar.meetingPassword}`,
    webinar.meetingInfo,
  ].filter(Boolean);
  if (infoLines.length > 0) {
    body += `\n\n──────────\n📌 會議資訊\n\n${infoLines.join("\n")}\n\n若點按鈕無法直接進入，請開啟會議程式後手動輸入上方 ID 與密碼。`;
  }

  const result = await sendBroadcast(
    [{ email }],
    webinar.emailSubject,
    () => buildBroadcastHtml(body, null),
  );
  if (result.sent === 0) {
    console.error("[webinar] 寄信失敗", { slug, email, error: result.error });
    return { error: "寄送失敗，請稍後再試；若持續失敗請聯繫我們" };
  }

  // 記錄索取（冪等）＋ 加入名單群組；兩者失敗都不影響「信已寄出」的結果
  try {
    await prisma.webinarRequest.upsert({
      where: { webinarId_email: { webinarId: webinar.id, email } },
      update: { sentCount: { increment: 1 }, lastSentAt: new Date() },
      create: {
        webinarId: webinar.id,
        email,
        sentCount: 1,
        lastSentAt: new Date(),
      },
    });
    if (webinar.groupId) {
      await prisma.mailGroupMember.upsert({
        where: { groupId_email: { groupId: webinar.groupId, email } },
        update: {},
        create: { groupId: webinar.groupId, email },
      });
    }
  } catch (e) {
    console.error("[webinar] 索取紀錄/名單寫入失敗", { slug, email, e });
  }

  return { success: "確認信已寄出，請到信箱查收（也請檢查垃圾郵件夾）！" };
}
