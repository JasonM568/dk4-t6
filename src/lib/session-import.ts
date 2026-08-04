import * as XLSX from "xlsx";
import { prisma } from "@/lib/db";

// 1shop 訂單檔匯入 → 場次報名歸類。
// 規則：金流狀態含「已付款」的列，依「產品」欄比對場次關鍵字歸入（最長關鍵字優先）；
// 訂單狀態含「取消」或金流狀態含「退款」的列，反向移除既有報名（訂單編號全域唯一）。
// 匯入冪等：@@unique(sessionId, orderNo) + skipDuplicates，重複上傳不重複計數。
// 不 import "server-only"：無機密，保留 tsx 腳本可測性；僅由 server actions 呼叫。

export type ImportReport = {
  totalRows: number;
  imported: number; // 新增報名
  duplicate: number; // 已在名單（冪等略過）
  unpaid: number; // 未付款略過
  canceledRemoved: number; // 取消/退款反向移除
  unmatched: { product: string; count: number }[]; // 對不到場次的產品（待補關鍵字）
  invalid: number; // 缺訂單編號/顧客的列
};

type ParsedRow = {
  orderNo: string;
  orderedAt: Date | null;
  orderStatus: string;
  name: string;
  product: string;
  paymentStatus: string;
  phone: string;
  email: string;
  amount: number | null;
};

// 標頭名 → 欄位（以標頭定位，不吃死欄位順序；1shop 匯出格式變動時較耐受）
const HEADERS = {
  orderNo: "訂單編號",
  orderedAt: "建立日期",
  orderStatus: "訂單狀態",
  name: "顧客",
  product: "產品",
  paymentStatus: "金流狀態",
  phone: "顧客電話",
  email: "顧客信箱",
  amount: "小計",
} as const;

export function parseOrderFile(buf: ArrayBuffer): ParsedRow[] {
  const wb = XLSX.read(buf, { type: "array" });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, raw: false });
  if (rows.length < 2) return [];

  const header = rows[0].map((h) => String(h ?? "").trim());
  const col: Partial<Record<keyof typeof HEADERS, number>> = {};
  for (const [key, label] of Object.entries(HEADERS)) {
    const idx = header.indexOf(label);
    if (idx >= 0) col[key as keyof typeof HEADERS] = idx;
  }
  if (col.orderNo === undefined || col.name === undefined || col.product === undefined) {
    throw new Error(
      "無法辨識檔案格式：找不到「訂單編號／顧客／產品」欄位，請確認是 1shop 匯出的訂單檔",
    );
  }

  const cell = (r: unknown[], i: number | undefined) =>
    i === undefined ? "" : String(r[i] ?? "").trim();

  return rows.slice(1).map((r) => {
    const dateStr = cell(r, col.orderedAt);
    const parsed = dateStr ? new Date(dateStr.replace(" ", "T")) : null;
    const amountStr = cell(r, col.amount);
    const amount = amountStr ? Math.round(Number(amountStr)) : null;
    return {
      orderNo: cell(r, col.orderNo),
      orderedAt: parsed && !Number.isNaN(parsed.getTime()) ? parsed : null,
      orderStatus: cell(r, col.orderStatus),
      name: cell(r, col.name),
      product: cell(r, col.product),
      paymentStatus: cell(r, col.paymentStatus),
      phone: cell(r, col.phone),
      email: cell(r, col.email),
      amount: amount !== null && Number.isFinite(amount) ? amount : null,
    };
  });
}

/** 依場次關鍵字歸類並寫入報名（冪等）；回傳匯入報告 */
export async function importOrders(buf: ArrayBuffer): Promise<ImportReport> {
  const rows = parseOrderFile(buf);
  const sessions = await prisma.courseSession.findMany({
    select: { id: true, keywords: true },
  });

  // 最長關鍵字優先：一列同時命中多場次時，取最具體（字最長）的關鍵字
  const matchSession = (product: string): string | null => {
    let best: { id: string; len: number } | null = null;
    for (const s of sessions) {
      for (const kw of s.keywords) {
        const k = kw.trim();
        if (k && product.includes(k) && (!best || k.length > best.len)) {
          best = { id: s.id, len: k.length };
        }
      }
    }
    return best?.id ?? null;
  };

  const report: ImportReport = {
    totalRows: rows.length,
    imported: 0,
    duplicate: 0,
    unpaid: 0,
    canceledRemoved: 0,
    unmatched: [],
    invalid: 0,
  };
  const unmatchedCount = new Map<string, number>();
  const toCreate: {
    sessionId: string;
    orderNo: string;
    name: string;
    email: string | null;
    phone: string | null;
    product: string;
    amount: number | null;
    orderedAt: Date | null;
  }[] = [];
  const cancelOrderNos: string[] = [];

  for (const row of rows) {
    if (!row.orderNo || !row.name) {
      report.invalid++;
      continue;
    }
    // 取消/退款 → 反向移除既有報名（訂單編號全域唯一，跨場次移除）
    if (row.orderStatus.includes("取消") || row.paymentStatus.includes("退款")) {
      cancelOrderNos.push(row.orderNo);
      continue;
    }
    if (!row.paymentStatus.includes("已付款")) {
      report.unpaid++;
      continue;
    }
    const sessionId = matchSession(row.product);
    if (!sessionId) {
      unmatchedCount.set(row.product, (unmatchedCount.get(row.product) ?? 0) + 1);
      continue;
    }
    toCreate.push({
      sessionId,
      orderNo: row.orderNo,
      name: row.name,
      email: row.email || null,
      phone: row.phone || null,
      product: row.product,
      amount: row.amount,
      orderedAt: row.orderedAt,
    });
  }

  if (cancelOrderNos.length > 0) {
    const del = await prisma.sessionSignup.deleteMany({
      where: { orderNo: { in: cancelOrderNos } },
    });
    report.canceledRemoved = del.count;
  }
  if (toCreate.length > 0) {
    const res = await prisma.sessionSignup.createMany({
      data: toCreate,
      skipDuplicates: true,
    });
    report.imported = res.count;
    report.duplicate = toCreate.length - res.count;
  }
  report.unmatched = [...unmatchedCount.entries()]
    .map(([product, count]) => ({ product, count }))
    .sort((a, b) => b.count - a.count);
  return report;
}
