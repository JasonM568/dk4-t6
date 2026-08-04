import * as XLSX from "xlsx";
import { prisma } from "@/lib/db";
import { normalizeMobile } from "@/lib/sms/phone";

// 1shop 訂單檔匯入 → 場次報名歸類。
// 規則：金流狀態含「已付款」的列，依「產品」欄比對場次關鍵字歸入（最長關鍵字優先）；
// 訂單狀態含「取消」或金流狀態含「退款」的列，反向移除既有報名（訂單編號全域唯一）。
// 匯入冪等：@@unique(sessionId, orderNo) + skipDuplicates，重複上傳不重複計數。
// 不 import "server-only"：無機密，保留 tsx 腳本可測性；僅由 server actions 呼叫。

/** 對不到場次關鍵字的已付款列：完整帶回給前端，讓管理員當場指定歸類。
 *  背景：課程改名（如量子課 3~6 月叫「人生升級」）會讓整批訂單默默被排除，
 *  以前只能補關鍵字後重傳檔案；現在改為列出來問管理員怎麼歸。
 *  orderedAt 用 ISO 字串：要跨 server action 邊界來回傳遞。 */
export type UnmatchedOrderRow = {
  orderNo: string;
  name: string;
  email: string | null;
  phone: string | null; // 原始字串，歸類寫入時才 normalizeMobile
  amount: number | null;
  orderedAt: string | null;
};

export type ImportReport = {
  totalRows: number;
  imported: number; // 新增報名
  duplicate: number; // 已在名單（冪等略過）
  unpaid: number; // 未付款略過
  canceledRemoved: number; // 取消/退款反向移除
  unmatched: { product: string; count: number; rows: UnmatchedOrderRow[] }[]; // 待管理員指定歸類
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

/**
 * 1shop 的「建立日期」是不帶時區的台北牆上時間（"2026-08-03 22:01:16"）。
 * 直接 new Date() 會用「伺服器時區」解讀——Vercel 是 UTC，會整整差 8 小時。
 * 台灣自 1980 起無日光節約時間，固定補 +08:00 即可。
 */
function parseTaipei(s: string): Date | null {
  const m = s.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
  if (!m) {
    // 認不得的格式：退回原生解析，至少不丟資料
    const d = new Date(s.replace(" ", "T"));
    return Number.isNaN(d.getTime()) ? null : d;
  }
  const [, y, mo, d, h, mi, sec] = m;
  const iso = `${y}-${mo.padStart(2, "0")}-${d.padStart(2, "0")}T${(h ?? "0").padStart(2, "0")}:${
    mi ?? "00"
  }:${sec ?? "00"}+08:00`;
  const parsed = new Date(iso);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

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
    const parsed = dateStr ? parseTaipei(dateStr) : null;
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
  const unmatchedRows = new Map<string, UnmatchedOrderRow[]>();
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
      // 對不到關鍵字：不再默默丟掉，整列帶回報告讓管理員指定歸類
      const list = unmatchedRows.get(row.product) ?? [];
      list.push({
        orderNo: row.orderNo,
        name: row.name,
        email: row.email || null,
        phone: row.phone || null,
        amount: row.amount,
        orderedAt: row.orderedAt?.toISOString() ?? null,
      });
      unmatchedRows.set(row.product, list);
      continue;
    }
    toCreate.push({
      sessionId,
      orderNo: row.orderNo,
      name: row.name,
      email: row.email || null,
      // 正規化成 09XXXXXXXX；市話、分機、格式錯誤一律存 null——
      // 簡訊模組寧可少一個收件人，也不要一個發不出去的號碼
      phone: normalizeMobile(row.phone),
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
  report.unmatched = [...unmatchedRows.entries()]
    .map(([product, rows]) => ({ product, count: rows.length, rows }))
    .sort((a, b) => b.count - a.count);
  return report;
}
