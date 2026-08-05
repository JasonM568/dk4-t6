"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requireEditor } from "@/lib/auth/staff";
import { buildBroadcastHtml, sendBroadcast } from "@/lib/email/broadcast";
import {
  BUDGET_OPTIONS,
  HEADCOUNT_OPTIONS,
  INQUIRY_STATUSES,
  TOPIC_OPTIONS,
  TRAINING_TYPE_OPTIONS,
} from "@/lib/corporate";

// 企業包班諮詢：訪客送單 ＋ 後台名單管理

export type CorporateInquiryState = { error?: string; success?: string } | null;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_RE = /^[0-9+()#\s-]{7,20}$/;
const DUP_WINDOW_MS = 10 * 60 * 1000; // 同 email 十分鐘內重複送單視為同一筆，不重複入庫
const NOTIFY_EMAIL_KEY = "corporateNotifyEmail"; // SiteSetting：新單通知收件人

const SUCCESS_MSG =
  "已收到您的包班需求！我們將於 1–2 個工作天內與您聯繫。";

/** 取字串欄位並裁切長度（表單值防呆） */
function field(formData: FormData, name: string, max: number): string {
  return String(formData.get(name) ?? "").trim().slice(0, max);
}

/** 下拉值白名單：不在選項內（被竄改）一律存 null */
function pickOption(value: string, options: readonly string[]): string | null {
  return options.includes(value) ? value : null;
}

/** 訪客送出諮詢：蜜罐 → 驗證 → 防重 → 入庫 → 通知管理員＋自動回覆（寄信失敗不影響收單） */
export async function submitCorporateInquiryAction(
  _prev: CorporateInquiryState,
  formData: FormData,
): Promise<CorporateInquiryState> {
  // 蜜罐：真人看不到的欄位有值 = 機器人，裝作成功不入庫（同講座頁做法，欄位名避開 autofill 字典）
  if (String(formData.get("hp_extra_note") ?? "").trim() !== "") {
    console.error("[corporate] 蜜罐觸發（機器人或 autofill 誤填）", {
      email: String(formData.get("email") ?? ""),
    });
    return { success: SUCCESS_MSG };
  }

  const companyName = field(formData, "companyName", 100);
  const contactName = field(formData, "contactName", 50);
  const contactTitle = field(formData, "contactTitle", 50) || null;
  const email = field(formData, "email", 200).toLowerCase();
  const phone = field(formData, "phone", 30);
  const preferredTime = field(formData, "preferredTime", 100) || null;
  const message = field(formData, "message", 2000) || null;

  if (!companyName) return { error: "請填寫公司／單位名稱" };
  if (!contactName) return { error: "請填寫聯絡人姓名" };
  if (!EMAIL_RE.test(email)) return { error: "Email 格式不正確，請再確認" };
  if (!PHONE_RE.test(phone)) return { error: "電話格式不正確，請再確認" };

  const topics = formData
    .getAll("topics")
    .map(String)
    .filter((t): t is (typeof TOPIC_OPTIONS)[number] =>
      (TOPIC_OPTIONS as readonly string[]).includes(t),
    );
  const headcount = pickOption(field(formData, "headcount", 20), HEADCOUNT_OPTIONS);
  const trainingType = pickOption(field(formData, "trainingType", 20), TRAINING_TYPE_OPTIONS);
  const budget = pickOption(field(formData, "budget", 20), BUDGET_OPTIONS);

  // 防重：同 email 十分鐘內已有單 → 直接回成功，不重複入庫也不重複轟炸通知信
  const recent = await prisma.corporateInquiry.findFirst({
    where: { email, createdAt: { gte: new Date(Date.now() - DUP_WINDOW_MS) } },
  });
  if (recent) return { success: SUCCESS_MSG };

  await prisma.corporateInquiry.create({
    data: {
      companyName,
      contactName,
      contactTitle,
      email,
      phone,
      headcount,
      topics,
      trainingType,
      preferredTime,
      budget,
      message,
    },
  });

  // 新單通知管理員（收件人存 SiteSetting，後台可改；未設定或寄失敗都不影響收單）
  try {
    const setting = await prisma.siteSetting.findUnique({
      where: { key: NOTIFY_EMAIL_KEY },
    });
    const notifyTo = setting?.value.trim().toLowerCase();
    if (notifyTo && EMAIL_RE.test(notifyTo)) {
      const lines = [
        "有新的企業包班諮詢：",
        "",
        `公司／單位：${companyName}`,
        `聯絡人：${contactName}${contactTitle ? `（${contactTitle}）` : ""}`,
        `Email：${email}`,
        `電話：${phone}`,
        headcount && `預計人數：${headcount}`,
        topics.length > 0 && `課程主題：${topics.join("、")}`,
        trainingType && `上課形式：${trainingType}`,
        preferredTime && `期望時段：${preferredTime}`,
        budget && `預算範圍：${budget}`,
        message && `需求說明：\n${message}`,
        "",
        "[📋 到後台查看名單](https://course.huangxi.info/admin/corporate)",
      ].filter(Boolean) as string[];
      const result = await sendBroadcast(
        [{ email: notifyTo }],
        `【企業包班】${companyName} 的諮詢需求`,
        () => buildBroadcastHtml(lines.join("\n"), null),
      );
      if (result.sent === 0)
        console.error("[corporate] 通知信寄送失敗", { notifyTo, error: result.error });
    }
  } catch (e) {
    console.error("[corporate] 通知信處理失敗", e);
  }

  // 自動回覆給聯絡人（失敗不影響收單）
  try {
    const replyBody = [
      `${contactName} 您好，`,
      "",
      `已收到 ${companyName} 的企業包班諮詢需求，我們將於 1–2 個工作天內由專人與您聯繫，確認課程主題、人數與時程後提供客製化提案。`,
      "",
      "若有急件，歡迎直接回覆此信補充說明。",
      "",
      "希望學院 敬上",
    ].join("\n");
    const result = await sendBroadcast(
      [{ email, name: contactName }],
      "已收到您的企業包班諮詢 — 希望學院",
      () => buildBroadcastHtml(replyBody, null),
    );
    if (result.sent === 0)
      console.error("[corporate] 自動回覆寄送失敗", { email, error: result.error });
  } catch (e) {
    console.error("[corporate] 自動回覆處理失敗", e);
  }

  return { success: SUCCESS_MSG };
}

/** 後台：更新諮詢單狀態與內部備註 */
export async function updateInquiryAction(
  id: string,
  _prev: CorporateInquiryState,
  formData: FormData,
): Promise<CorporateInquiryState> {
  await requireEditor();
  const status = String(formData.get("status") ?? "").trim();
  if (!INQUIRY_STATUSES.some((s) => s.value === status))
    return { error: "狀態值不正確" };
  const adminNote = String(formData.get("adminNote") ?? "").trim() || null;
  await prisma.corporateInquiry.update({ where: { id }, data: { status, adminNote } });
  revalidatePath("/admin/corporate");
  return { success: "已更新" };
}

/** 後台：刪除諮詢單（客戶端先 confirm） */
export async function deleteInquiryAction(id: string) {
  await requireEditor();
  await prisma.corporateInquiry.delete({ where: { id } }).catch(() => undefined);
  revalidatePath("/admin/corporate");
}

/** 後台：設定新單通知收件人（存 SiteSetting；留空 = 關閉通知信） */
export async function setCorporateNotifyEmailAction(
  _prev: CorporateInquiryState,
  formData: FormData,
): Promise<CorporateInquiryState> {
  await requireEditor();
  const value = String(formData.get("notifyEmail") ?? "").trim().toLowerCase();
  if (value && !EMAIL_RE.test(value)) return { error: "Email 格式不正確" };
  await prisma.siteSetting.upsert({
    where: { key: NOTIFY_EMAIL_KEY },
    update: { value },
    create: { key: NOTIFY_EMAIL_KEY, value },
  });
  revalidatePath("/admin/corporate");
  return { success: value ? "已更新通知收件人" : "已關閉新單通知信" };
}
