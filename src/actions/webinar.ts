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

function parseWebinarForm(formData: FormData) {
  const slug = String(formData.get("slug") ?? "").trim().toLowerCase();
  const title = String(formData.get("title") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim();
  const lectureUrl = String(formData.get("lectureUrl") ?? "").trim();
  const emailSubject = String(formData.get("emailSubject") ?? "").trim();
  const emailBody = String(formData.get("emailBody") ?? "").trim() || DEFAULT_EMAIL_BODY;
  const groupId = String(formData.get("groupId") ?? "").trim() || null;
  const isActive = formData.get("isActive") === "on";

  if (!SLUG_RE.test(slug)) return { error: "網址代稱只能用小寫英數與連字號（例：ai-webinar-0815）" as const };
  if (!title) return { error: "請填寫講座標題" as const };
  if (!/^https?:\/\//.test(lectureUrl)) return { error: "講座連結須為 http(s) 網址" as const };
  if (!emailSubject) return { error: "請填寫信件主旨" as const };
  return { slug, title, description, lectureUrl, emailSubject, emailBody, groupId, isActive };
}

export async function createWebinarAction(
  _prev: WebinarFormState,
  formData: FormData,
): Promise<WebinarFormState> {
  await requireEditor();
  const parsed = parseWebinarForm(formData);
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
  const parsed = parseWebinarForm(formData);
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

  // 信件內文：{link} 換成講座連結；內文沒提到連結就自動補 CTA 按鈕
  let body = webinar.emailBody;
  if (!body.includes("{link}") && !body.includes(webinar.lectureUrl)) {
    body += `\n\n[▶️ 進入講座]({link})`;
  }
  body = body.replaceAll("{link}", webinar.lectureUrl);

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
