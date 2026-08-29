import { prisma } from "@/lib/db";

// 訂單編號：[銷售頁代碼][日期YYYYMMDD][當日筆數3碼]，例：HA00120260829001
//
// 代碼來源＝課程的「課程編號」（courseCode，如 HA-001），正規化為純英數大寫；
// 未填編號的課程以 slug 的英數字元湊，再不行用 OD。
// 長度預算（ezPay MerchantOrderNo ≤20 是最嚴的）：代碼 ≤8 + 日期 8 + 流水 3 = ≤19，
// 當日破千筆流水自然長成 4 碼仍在 20 內。
//
// 可預測性：日期＋流水可被猜號，但 /orders/[orderNo] 有擁有者驗證
// （非本人一律 404），枚舉只洩漏當日銷量，屬可接受的取捨（換來人可讀的單號）。
// 併發防重：不靠「先數再建」的原子性——orderNo @unique 兜底，撞號由呼叫端
// 重數重試（見 checkout 的 P2002 處理）。

/** 課程 → 銷售頁代碼：courseCode 去非英數轉大寫；空則取 slug 英數前 6 碼；再空則 OD */
export function salesPageCode(course: { courseCode?: string | null; slug?: string | null }): string {
  const fromCode = (course.courseCode ?? "").replace(/[^A-Za-z0-9]/g, "").toUpperCase();
  if (fromCode) return fromCode.slice(0, 8);
  const fromSlug = (course.slug ?? "").replace(/[^A-Za-z0-9]/g, "").toUpperCase();
  if (fromSlug) return fromSlug.slice(0, 6);
  return "OD";
}

/** 台北時區的 YYYYMMDD（訂單日以台北日曆日為準，跨午夜不會歸錯天） */
export function taipeiDateStamp(now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const get = (t: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("year")}${get("month")}${get("day")}`;
}

/** 組編號：前綴 + 日期 + 左補零流水（3 碼起跳，破千自然變長） */
export function composeOrderNo(code: string, dateStamp: string, seq: number): string {
  return `${code}${dateStamp}${String(seq).padStart(3, "0")}`;
}

/** 產生下一個訂單編號：數「同代碼同日」既有筆數 +1。
 *  count 到 create 之間有 race window——orderNo @unique 會擋下撞號，
 *  呼叫端收到 P2002 時 attempt+1 重呼（每次重呼會重新 count，自然遞增）。 */
export async function nextOrderNo(
  course: { courseCode?: string | null; slug?: string | null },
  attempt = 0,
): Promise<string> {
  const code = salesPageCode(course);
  const stamp = taipeiDateStamp();
  const prefix = `${code}${stamp}`;
  const count = await prisma.order.count({ where: { orderNo: { startsWith: prefix } } });
  return composeOrderNo(code, stamp, count + 1 + attempt);
}
