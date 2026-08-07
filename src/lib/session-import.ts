import ExcelJS from "exceljs";
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

// 解析防線：惡意/畸形檔案要快速安全失敗，不能拖垮 serverless function
const PARSE_LIMITS = {
  maxRows: 20_000, // 1shop 單檔實務上是數百列，2 萬列已是十倍餘裕
  maxCols: 60,
  maxCellLen: 2_000,
} as const;

/** Excel 序號日期在 exceljs 會轉成 UTC 牆上時間的 Date：取 UTC 分量還原成
 *  「YYYY-MM-DD HH:mm:ss」字串，交給 parseTaipei 統一補 +08:00 */
function utcWallString(d: Date): string {
  const p = (n: number, w = 2) => String(n).padStart(w, "0");
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ${p(
    d.getUTCHours(),
  )}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}`;
}

/** exceljs 各種 cell value（字串/數字/日期/超連結/富文字/公式）一律收斂成純文字 */
function cellText(v: ExcelJS.CellValue): string {
  if (v == null) return "";
  if (v instanceof Date) return utcWallString(v);
  if (typeof v === "object") {
    if ("richText" in v) return v.richText.map((t) => t.text).join("");
    if ("text" in v) return String(v.text ?? "");
    if ("result" in v) return cellText(v.result as ExcelJS.CellValue);
    if ("error" in v) return "";
    return "";
  }
  return String(v);
}

/** RFC 4180 CSV 解析（引號欄位/內嵌逗號換行/雙引號跳脫），內建列欄與長度上限。
 *  CSV 不交給 XLSX parser：格式單純就用單純的解析器，縮小攻擊面 */
function parseCsvRows(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  const pushField = () => {
    if (row.length >= PARSE_LIMITS.maxCols) throw new Error("檔案欄位數過多，請確認是 1shop 匯出的訂單檔");
    row.push(field.slice(0, PARSE_LIMITS.maxCellLen));
    field = "";
  };
  const pushRow = () => {
    pushField();
    // 略過整列空白（尾端空行常見）
    if (row.some((c) => c.trim() !== "")) {
      if (rows.length >= PARSE_LIMITS.maxRows) throw new Error("檔案列數過多，請分批匯出後再上傳");
      rows.push(row);
    }
    row = [];
  };

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else inQuotes = false;
      } else field += ch;
    } else if (ch === '"' && field === "") {
      inQuotes = true;
    } else if (ch === ",") {
      pushField();
    } else if (ch === "\n") {
      pushRow();
    } else if (ch !== "\r") {
      field += ch;
    }
    if (field.length > PARSE_LIMITS.maxCellLen) field = field.slice(0, PARSE_LIMITS.maxCellLen);
  }
  if (field !== "" || row.length > 0) pushRow();
  return rows;
}

/** 解碼 CSV bytes：先試 UTF-8，出現亂碼再退 Big5（與 src/lib/csv.ts 同策略；
 *  這裡不 import 是因為該檔標記 server-only，會斷掉 tsx 腳本可測性） */
function decodeCsvText(buf: ArrayBuffer): string {
  const utf8 = new TextDecoder("utf-8").decode(buf);
  if (!utf8.includes("�")) return utf8;
  try {
    return new TextDecoder("big5").decode(buf);
  } catch {
    return utf8;
  }
}

/** XLSX（zip 容器）→ exceljs 讀第一張工作表；限制列欄數 */
async function parseXlsxRows(buf: ArrayBuffer): Promise<string[][]> {
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(buf);
  } catch {
    throw new Error("無法解析 XLSX 檔案，請確認是 1shop 匯出的訂單檔");
  }
  const ws = wb.worksheets[0];
  if (!ws) return [];
  if (ws.actualRowCount > PARSE_LIMITS.maxRows)
    throw new Error("檔案列數過多，請分批匯出後再上傳");
  if (ws.actualColumnCount > PARSE_LIMITS.maxCols)
    throw new Error("檔案欄位數過多，請確認是 1shop 匯出的訂單檔");

  const rows: string[][] = [];
  ws.eachRow({ includeEmpty: false }, (row) => {
    const cells: string[] = [];
    // row.values 是 1-indexed；固定掃到 actualColumnCount 保留欄位對位
    for (let c = 1; c <= Math.min(ws.actualColumnCount, PARSE_LIMITS.maxCols); c++) {
      cells.push(cellText(row.getCell(c).value).slice(0, PARSE_LIMITS.maxCellLen));
    }
    rows.push(cells);
  });
  return rows;
}

export async function parseOrderFile(buf: ArrayBuffer): Promise<ParsedRow[]> {
  // 不相信副檔名/瀏覽器 MIME，用 magic bytes 判型：
  //   PK\x03\x04 = zip 容器（xlsx）；D0 CF 11 E0 = 舊版 .xls（拒收）；其他當 CSV 文字
  const head = new Uint8Array(buf.slice(0, 4));
  const isZip = head[0] === 0x50 && head[1] === 0x4b && head[2] === 0x03 && head[3] === 0x04;
  const isLegacyXls =
    head[0] === 0xd0 && head[1] === 0xcf && head[2] === 0x11 && head[3] === 0xe0;
  if (isLegacyXls)
    throw new Error("不支援舊版 .xls 格式，請從 1shop 重新匯出 .xlsx 或 .csv");

  const rows = isZip ? await parseXlsxRows(buf) : parseCsvRows(decodeCsvText(buf));
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
  const rows = await parseOrderFile(buf);
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
