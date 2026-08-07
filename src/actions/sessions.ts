"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requireEditor } from "@/lib/auth/staff";
import { importOrders, type ImportReport } from "@/lib/session-import";
import { explainMobile, normalizeMobile, MOBILE_REJECT_LABEL } from "@/lib/sms/phone";

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
  const endStr = String(formData.get("endDate") ?? "").trim();
  const keywords = String(formData.get("keywords") ?? "")
    .split(/[,，\n]/)
    .map((k) => k.trim())
    .filter(Boolean);
  const isVisible = formData.get("isVisible") === "on";
  const eventDate = dateStr ? new Date(dateStr) : null;
  if (eventDate && Number.isNaN(eventDate.getTime()))
    return { error: "開課日期格式錯誤" as const };
  const endDate = endStr ? new Date(endStr) : null;
  if (endDate && Number.isNaN(endDate.getTime()))
    return { error: "結束日期格式錯誤" as const };
  if (endDate && eventDate && endDate < eventDate)
    return { error: "結束日不能早於開課日" as const };
  return { title, eventDate, endDate, keywords, isVisible };
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
  const phoneInput = String(formData.get("phone") ?? "").trim();
  const isRetrain = String(formData.get("type")) === "retrain";
  if (!name) return { error: "請填寫姓名" };

  // 手機選填；但填了就一定要是能收簡訊的號碼——存進去卻發不出簡訊比留空更糟
  let phone: string | null = null;
  if (phoneInput) {
    const { mobile, reject } = explainMobile(phoneInput);
    if (!mobile)
      return {
        error: `手機${reject ? `：${MOBILE_REJECT_LABEL[reject]}` : "格式不正確"}（請填 09 開頭 10 碼，或留空）`,
      };
    phone = mobile;
  }

  // 沒填訂單編號就生一組「手動-」流水（orderNo 是場次內冪等鍵，不能留空）
  const orderNo =
    orderNoInput || `手動-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

  // 舊生判別全站統一看 product 是否含「複訓」——選舊生就自動補上標記
  const base = note || "手動新增";
  const product = isRetrain && !base.includes("複訓") ? `複訓｜${base}` : base;

  try {
    await prisma.sessionSignup.create({
      data: {
        sessionId,
        orderNo,
        name,
        phone,
        product,
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

/** 把「對不到關鍵字」的訂單列歸入管理員指定的場次。
 *
 *  來源是 uploadOrdersAction 回傳報告裡的 unmatched rows（課程改名時
 *  整批對不到，如量子課 3~6 月叫「人生升級」）。冪等：同單同場次只算一筆，
 *  重複歸類不會重複計數。可選擇同時把產品名加入場次關鍵字，之後再傳同名
 *  訂單檔就會自動歸類，不必再問一次。 */
export async function assignUnmatchedAction(
  _prev: SessionFormState,
  formData: FormData,
): Promise<SessionFormState> {
  await requireEditor();
  const sessionId = String(formData.get("sessionId") ?? "");
  const product = String(formData.get("product") ?? "").trim();
  const addKeyword = formData.get("addKeyword") === "on";
  if (!sessionId) return { error: "請選擇要歸入的場次" };
  if (!product) return { error: "缺少產品名稱" };

  // rows 來自上傳報告經前端 hidden input 帶回，防禦性解析：壞資料擋下不寫入
  let rows: {
    orderNo: string;
    name: string;
    email: string | null;
    phone: string | null;
    amount: number | null;
    orderedAt: string | null;
  }[];
  try {
    const parsed: unknown = JSON.parse(String(formData.get("rows") ?? "[]"));
    if (!Array.isArray(parsed) || parsed.length === 0 || parsed.length > 2000)
      return { error: "名單資料不完整，請重新上傳訂單檔" };
    rows = parsed.filter(
      (r): r is (typeof rows)[number] =>
        !!r && typeof r === "object" &&
        typeof (r as { orderNo?: unknown }).orderNo === "string" &&
        !!(r as { orderNo: string }).orderNo &&
        typeof (r as { name?: unknown }).name === "string" &&
        !!(r as { name: string }).name,
    );
    if (rows.length === 0) return { error: "名單資料不完整，請重新上傳訂單檔" };
  } catch {
    return { error: "名單資料不完整，請重新上傳訂單檔" };
  }

  const session = await prisma.courseSession.findUnique({
    where: { id: sessionId },
    select: { id: true, title: true, keywords: true },
  });
  if (!session) return { error: "場次不存在（可能剛被刪除），請重新選擇" };

  const res = await prisma.sessionSignup.createMany({
    data: rows.map((r) => {
      const orderedAt = r.orderedAt ? new Date(r.orderedAt) : null;
      return {
        sessionId: session.id,
        orderNo: r.orderNo,
        name: r.name,
        email: r.email || null,
        phone: normalizeMobile(r.phone), // 與訂單檔匯入同一套正規化
        product,
        amount: typeof r.amount === "number" ? r.amount : null,
        orderedAt: orderedAt && !Number.isNaN(orderedAt.getTime()) ? orderedAt : null,
      };
    }),
    skipDuplicates: true,
  });

  // 同時補關鍵字：之後上傳同名產品的訂單檔就自動歸類，不必再問
  if (addKeyword && !session.keywords.includes(product)) {
    await prisma.courseSession.update({
      where: { id: session.id },
      data: { keywords: { push: product } },
    });
  }

  revalidatePath("/admin/sessions");
  revalidatePath("/board");
  const dup = rows.length - res.count;
  return {
    success: `已把「${product}」${res.count} 筆歸入「${session.title}」${
      dup > 0 ? `（${dup} 筆已在名單略過）` : ""
    }${addKeyword ? "，並已加入場次關鍵字" : ""}`,
  };
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
  // 副檔名允許清單（實際檔型另由 parseOrderFile 的 magic bytes 判定，不信 MIME）
  if (!/\.(xlsx|csv)$/i.test(file.name))
    return { error: "只接受 .xlsx 或 .csv 檔（1shop 匯出的訂單檔）" };

  try {
    const report = await importOrders(await file.arrayBuffer());
    revalidatePath("/admin/sessions");
    revalidatePath("/board");
    return { report };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "解析失敗，請確認檔案格式" };
  }
}

/** 看板設定：4 位碼＋登入時效（存 SiteSetting；改碼即讓所有既有看板 cookie 失效） */
export async function saveBoardCodeAction(
  _prev: SessionFormState,
  formData: FormData,
): Promise<SessionFormState> {
  await requireEditor();
  const code = String(formData.get("code") ?? "").trim();
  const hours = Math.round(Number(String(formData.get("hours") ?? "").trim()));
  if (!/^\d{4}$/.test(code)) return { error: "登入碼須為 4 位數字" };
  if (!Number.isFinite(hours) || hours < 1 || hours > 720)
    return { error: "登入時效須為 1–720 小時" };
  await prisma.$transaction([
    prisma.siteSetting.upsert({
      where: { key: "boardCode" },
      update: { value: code },
      create: { key: "boardCode", value: code },
    }),
    prisma.siteSetting.upsert({
      where: { key: "boardSessionHours" },
      update: { value: String(hours) },
      create: { key: "boardSessionHours", value: String(hours) },
    }),
  ]);
  revalidatePath("/admin/sessions");
  return {
    success: `看板設定已更新：登入後 ${hours} 小時自動登出（時效變更只影響之後的登入；改碼則立即全面登出）`,
  };
}
