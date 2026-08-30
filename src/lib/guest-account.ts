import "server-only";
import { randomBytes } from "node:crypto";
import { prisma } from "@/lib/db";
import {
  createMember,
  findAuthUserIdByEmail,
  generateSetPasswordLink,
} from "@/lib/supabase/admin";
import { buildBroadcastHtml, sendBroadcast } from "@/lib/email/broadcast";
import { claimStudentRecord } from "@/lib/student-history";

// 訪客購課 → 自動成為會員。
//
// 時機在「付款成功」而非下單當下：未付款不建帳號，公開結帳端點就無法被拿來灌帳號。
// 已有帳號的 email 一律連結既有帳號（不重建、不覆蓋密碼），等同這筆購買掛到他原本的會員。
// 密碼絕不自訂也不寄明碼——建立時給一組亂數，再寄「設定密碼」連結請本人自己設。

export type GuestAccountResult =
  | { ok: true; userId: string; created: boolean }
  | { ok: false; error: string };

/** 依 email 找出或建立會員帳號，回傳 userId。created=true 表示這次新建。 */
export async function provisionGuestAccount(
  email: string,
  displayName?: string | null,
): Promise<GuestAccountResult> {
  const normalized = email.trim().toLowerCase();
  if (!normalized) return { ok: false, error: "缺少 email" };

  // 既有帳號優先：同一個人用沒登入的瀏覽器買課，購買要掛回他原本的帳號
  const existing = await findAuthUserIdByEmail(normalized);
  if (existing) return { ok: true, userId: existing, created: false };

  // 亂數密碼：只為了讓 GoTrue 建得起帳號，不保存、不寄出、不顯示
  const throwawayPassword = randomBytes(24).toString("base64url");
  const res = await createMember({
    email: normalized,
    password: throwawayPassword,
    displayName: displayName?.trim() || normalized.split("@")[0],
  });

  if (res.ok) return { ok: true, userId: res.userId, created: true };
  // 併發下單／剛好同時註冊：createMember 會回 exists 並附既有 userId
  if (res.reason === "exists" && res.userId) {
    return { ok: true, userId: res.userId, created: false };
  }
  return {
    ok: false,
    error: res.reason === "exists" ? "此信箱已有帳號但查不到 id" : "建立帳號失敗",
  };
}

/** 補齊新會員的資料：訂購人姓名／電話寫進 MemberProfile、認領學員上課紀錄。
 *  個資同意不代填（privacyConsentAt 留 null）——同意必須由本人勾選，
 *  他下次登入會被導到補填頁確認。失敗不影響購買成立。 */
export async function fillGuestProfile(
  userId: string,
  input: { email: string; name?: string | null; phone?: string | null },
): Promise<void> {
  try {
    if (input.name || input.phone) {
      await prisma.memberProfile.upsert({
        where: { userId },
        update: {
          // 只補空值，不覆蓋會員自己填過的資料
          ...(input.name ? { name: input.name } : {}),
          ...(input.phone ? { phone: input.phone } : {}),
        },
        create: {
          userId,
          name: input.name || null,
          phone: input.phone || "",
        },
      });
    }
  } catch (e) {
    console.error("[guest-account] 補會員資料失敗", { userId, e });
  }
  try {
    await claimStudentRecord(userId, { email: input.email, phone: input.phone });
  } catch (e) {
    console.error("[guest-account] 認領學員紀錄失敗", { userId, e });
  }
}

/** 購課成功通知信（新建帳號版）：告知已開通 + 設定密碼連結。
 *  寄不出去不影響購買成立，只記 log（後台看得到訂單）。 */
export async function sendGuestWelcomeEmail(input: {
  email: string;
  name?: string | null;
  courseTitle: string;
  courseSlug: string;
}): Promise<void> {
  const base = process.env.NEXT_PUBLIC_BASE_URL ?? "https://course.huangxi.info";
  const link = await generateSetPasswordLink(input.email);
  const who = input.name?.trim() || "同學";

  const lines = [
    `${who} 您好，感謝您購買「${input.courseTitle}」！`,
    "",
    "## 課程已開通",
    "我們已用這個信箱幫您建立希望學院的會員帳號，課程觀看權限已經開通。",
    "",
    "## 第一次登入請先設定密碼",
    link
      ? `請點下方按鈕設定您的密碼，設定完成後即可開始觀看課程：\n\n[設定密碼並開始上課](${link})\n\n（此連結有時效，過期請到登入頁點「忘記密碼」重新取得。）`
      : `請到登入頁點「忘記密碼」設定您的密碼：\n\n[前往設定密碼](${base}/forgot-password)`,
    "",
    "---",
    "",
    `設定完成後，可從「我的課程」隨時觀看：${base}/my-courses`,
    "",
    "希望學院 敬上",
  ];

  const html = buildBroadcastHtml(lines.join("\n"), null, null, "NOTICE");
  const res = await sendBroadcast(
    [{ email: input.email, name: input.name ?? undefined }],
    `【課程已開通】${input.courseTitle}`,
    () => html,
  );
  if (res.sent === 0) {
    console.error("[guest-account] 購課通知信寄送失敗", {
      email: input.email,
      error: res.error,
    });
  }
}

/** 購課成功通知信（既有帳號版）：不談設定密碼，直接請他登入觀看。 */
export async function sendExistingMemberPurchaseEmail(input: {
  email: string;
  name?: string | null;
  courseTitle: string;
}): Promise<void> {
  const base = process.env.NEXT_PUBLIC_BASE_URL ?? "https://course.huangxi.info";
  const who = input.name?.trim() || "同學";
  const lines = [
    `${who} 您好，感謝您購買「${input.courseTitle}」！`,
    "",
    "課程觀看權限已開通到您原本的會員帳號（就是這個信箱）。",
    "",
    `[登入開始上課](${base}/login)`,
    "",
    "忘記密碼的話，登入頁點「忘記密碼」即可重設。",
    "",
    "希望學院 敬上",
  ];
  const html = buildBroadcastHtml(lines.join("\n"), null, null, "NOTICE");
  const res = await sendBroadcast(
    [{ email: input.email, name: input.name ?? undefined }],
    `【課程已開通】${input.courseTitle}`,
    () => html,
  );
  if (res.sent === 0) {
    console.error("[guest-account] 購課通知信寄送失敗（既有會員）", {
      email: input.email,
      error: res.error,
    });
  }
}
