"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requireEditor } from "@/lib/auth/staff";
import { importOrders, type ImportReport } from "@/lib/session-import";

// 課程場次看板：後台管理 actions（場次 CRUD / 訂單匯入 / 看板 4 位碼）

export type SessionFormState = { error?: string; success?: string } | null;
export type UploadState =
  | { error?: string; report?: ImportReport }
  | null;

const MAX_UPLOAD_BYTES = 10 * 1024 * 1024; // 與 next.config bodySizeLimit 12mb 保持餘裕

/** 解析場次表單共同欄位 */
function parseSessionForm(formData: FormData) {
  const title = String(formData.get("title") ?? "").trim();
  const dateStr = String(formData.get("eventDate") ?? "").trim();
  const keywords = String(formData.get("keywords") ?? "")
    .split(/[,，\n]/)
    .map((k) => k.trim())
    .filter(Boolean);
  const isVisible = formData.get("isVisible") === "on";
  const eventDate = dateStr ? new Date(dateStr) : null;
  if (eventDate && Number.isNaN(eventDate.getTime()))
    return { error: "開課日期格式錯誤" as const };
  return { title, eventDate, keywords, isVisible };
}

export async function createSessionAction(
  _prev: SessionFormState,
  formData: FormData,
): Promise<SessionFormState> {
  await requireEditor();
  const parsed = parseSessionForm(formData);
  if ("error" in parsed) return { error: parsed.error };
  if (!parsed.title) return { error: "請填寫場次名稱" };
  if (parsed.keywords.length === 0)
    return { error: "請至少填一個產品關鍵字（訂單歸類依據）" };

  await prisma.courseSession.create({ data: parsed });
  revalidatePath("/admin/sessions");
  return { success: `已建立場次「${parsed.title}」` };
}

export async function updateSessionAction(
  id: string,
  _prev: SessionFormState,
  formData: FormData,
): Promise<SessionFormState> {
  await requireEditor();
  const parsed = parseSessionForm(formData);
  if ("error" in parsed) return { error: parsed.error };
  if (!parsed.title) return { error: "請填寫場次名稱" };

  await prisma.courseSession.update({ where: { id }, data: parsed });
  revalidatePath("/admin/sessions");
  revalidatePath("/board");
  return { success: "已更新" };
}

/** 刪除場次（連同報名紀錄，客戶端先 confirm） */
export async function deleteSessionAction(id: string) {
  await requireEditor();
  await prisma.courseSession.delete({ where: { id } }).catch(() => undefined);
  revalidatePath("/admin/sessions");
  revalidatePath("/board");
}

/** 手動新增報名（電話報名/現金/特殊訂單等，不經訂單檔） */
export async function addSignupAction(
  sessionId: string,
  _prev: SessionFormState,
  formData: FormData,
): Promise<SessionFormState> {
  await requireEditor();
  const name = String(formData.get("name") ?? "").trim();
  const orderNoInput = String(formData.get("orderNo") ?? "").trim();
  const note = String(formData.get("note") ?? "").trim();
  if (!name) return { error: "請填寫姓名" };

  // 沒填訂單編號就生一組「手動-」流水（orderNo 是場次內冪等鍵，不能留空）
  const orderNo =
    orderNoInput || `手動-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

  try {
    await prisma.sessionSignup.create({
      data: {
        sessionId,
        orderNo,
        name,
        product: note || "手動新增",
        orderedAt: new Date(),
      },
    });
  } catch {
    return { error: `訂單編號 ${orderNo} 已在這個場次的名單裡` };
  }
  revalidatePath("/admin/sessions");
  revalidatePath("/board");
  return { success: `已加入 ${name}` };
}

/** 移除單筆報名（誤歸類等，客戶端先 confirm） */
export async function removeSignupAction(id: string) {
  await requireEditor();
  await prisma.sessionSignup.delete({ where: { id } }).catch(() => undefined);
  revalidatePath("/admin/sessions");
  revalidatePath("/board");
}

/** 上傳 1shop 訂單檔 → 解析歸類匯入 */
export async function uploadOrdersAction(
  _prev: UploadState,
  formData: FormData,
): Promise<UploadState> {
  await requireEditor();
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0)
    return { error: "請選擇訂單檔（1shop 匯出的 .xlsx 或 .csv）" };
  if (file.size > MAX_UPLOAD_BYTES)
    return { error: "檔案超過 10MB，請確認是否選錯檔案" };

  try {
    const report = await importOrders(await file.arrayBuffer());
    revalidatePath("/admin/sessions");
    revalidatePath("/board");
    return { report };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "解析失敗，請確認檔案格式" };
  }
}

/** 看板 4 位碼：存 SiteSetting（改碼即讓所有既有看板 cookie 失效） */
export async function saveBoardCodeAction(
  _prev: SessionFormState,
  formData: FormData,
): Promise<SessionFormState> {
  await requireEditor();
  const code = String(formData.get("code") ?? "").trim();
  if (!/^\d{4}$/.test(code)) return { error: "登入碼須為 4 位數字" };
  await prisma.siteSetting.upsert({
    where: { key: "boardCode" },
    update: { value: code },
    create: { key: "boardCode", value: code },
  });
  revalidatePath("/admin/sessions");
  return { success: "看板登入碼已更新（舊碼登入的裝置需重新輸入）" };
}
