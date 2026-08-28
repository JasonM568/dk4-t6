import ExcelJS from "exceljs";
import { prisma } from "@/lib/db";
import {
  collectOrderFinance,
  markRefundedOrders,
  persistOrderFinance,
  emptyFinanceReport,
  type FinanceImportReport,
} from "./session-finance-import";
import { normalizeMobile, normalizeContactPhone } from "@/lib/sms/phone";
import {
  MEAL_HEADER_RE,
  MEAL_IN_TEXT_RE,
  parseMealValue,
  isSamePerson,
  type Meal,
} from "@/lib/session-roster";

// 1shop 訂單檔匯入 → 場次報名歸類。
// 規則：金流狀態含「已付款」的列，依「產品」欄比對場次關鍵字歸入（最長關鍵字優先）；
// 訂單狀態含「取消」或金流狀態含「退款」的列，反向移除既有報名（訂單編號全域唯一）。
// 匯入冪等：@@unique(sessionId, orderNo, attendeeKey) + skipDuplicates；同一訂單的同行者各自入列。
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
  meal: Meal | null; // 葷素（管理員指定歸類寫入時一併帶上）
  seats: number | null; // 訂單數量＝席次（null = 檔案沒有數量欄）；同行者最多建 席次-1 列
  attendees: OrderAttendee[];
};

export type OrderAttendee = {
  key: string;
  name: string;
  // 同行欄常見「姓名＋電話」一起填（如「同行學員的聯絡資料」），有些還附信箱——抽得到就帶上
  phone?: string | null;
  email?: string | null;
};

export type ImportReport = {
  totalRows: number;
  imported: number; // 新增報名
  duplicate: number; // 已在名單（冪等略過）
  unpaid: number; // 未付款略過
  canceledRemoved: number; // 取消/退款反向移除
  unmatched: { product: string; count: number; rows: UnmatchedOrderRow[] }[]; // 待管理員指定歸類
  invalid: number; // 缺訂單編號/顧客的列
  mealColumnFound: boolean; // 檔案裡有沒有葷素欄位（餐點/用餐…）
  mealUnknown: number; // 有欄位但該列值空白（已付款且歸入場次的列才計）
  // 席次（訂單數量加總）比辨識出的報名者多：同行者資料可能沒填/格式認不得，
  // 要人工確認補上（實例：黃淑華訂 2 位但同行欄格式解析失敗）
  companionCheck: { orderNo: string; name: string; quantity: number; found: number }[];
  // 只買 1 席卻在同行欄填了人 → 那是「跟誰一起上課」，不是多買位子（對方多半自己下單）。
  // 沒有入列，但列出來讓管理員確認：萬一對方真的沒下單卻要來，要手動補。
  seatOverflow: {
    orderNo: string;
    name: string;
    seats: number;
    dropped: string[];
    sessionTitle: string;
  }[];
  // 同一場次同一個人以「不同訂單編號」再次進來 → 沒有建新列（唯一鍵抓不到這種重複）。
  // 實例：歐洸熏 8/7 手動補進名單、8/10 重匯時同行欄解析成功又要建一筆。
  // 萬一其實是同名的不同人，看這份清單手動補回來。
  dupSkipped: {
    name: string;
    orderNo: string;
    existingOrderNo: string;
    sessionTitle: string;
  }[];
  // 金額第二階段（收支模組）的結果；名單數字在上面，錢的數字在這裡
  finance: FinanceImportReport;
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
  meal: Meal | null;
  quantity: number | null; // 訂單明細數量（有欄位才有值）
  // 收支模組用：付款方式原文（「金流」欄）與每人單價；名單邏輯完全不讀這兩個欄位
  paymentMethodRaw: string | null;
  unitPrice: number | null;
  attendees: OrderAttendee[];
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
  // 收支模組用（optional：舊匯出檔沒有也不影響名單匯入）
  paymentMethod: "金流",
  unitPrice: "單價",
} as const;

/** 1shop 的自訂欄位會直接成為匯出欄位。各銷售頁的命名不同，因此以欄位
 * 語意辨識同行者，而不是把欄位位置或某一個固定名稱寫死。
 * 實例欄名：「同行學員的聯絡資料：」——學員常把姓名＋電話一起填。 */
const COMPANION_HEADER_RE = /同行|同伴|友人|朋友|(?:學員|參加(?:者|人)?|報名(?:者|人)?)(?:\s*(?:姓名|名字|名稱)|[0-9０-９])/;
const ORDER_INFO_HEADER_RE = /訂單資訊|訂單備註|顧客備註|備註/;
const COMPANION_IN_TEXT_RE = /(?:同行(?:者|人|友人)?|同伴|友人|朋友|學員|參加者?)\s*(?:姓名)?\s*(?:[0-9０-９]+)?\s*[:：]\s*([^\n\r]+)/g;
// 片段裡的台灣手機（允許 - 與空白間隔）；先抽電話再清姓名，
// 否則「王小美 0912345678」整段含數字會被姓名檢核整個丟掉
const PHONE_IN_TEXT_RE = /09\d(?:[-\s]?\d){7}/;
// 「姓名緊鄰電話」成對抽取——多位同行者各自帶電話時（「歐洸熏/0975085939 曾照恩/0932647608」）
// 逐片切開會把 A 的電話配給 B，成對抽取才配得對
const NAME_PHONE_PAIR_RE = /([A-Za-zÀ-ɏ一-鿿·]{2,12})\s*[／/｜|]?\s*(09\d(?:[-\s]?\d){7})/g;
const EMAIL_IN_TEXT_RE = /[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/g;
// 清掉學員照表單提示照抄的標籤字（「姓名：王小美 電話：09…」「第二位：」）
const LABEL_TOKEN_RE = /(?:同行\s*)?(?:學員|友人)?\s*(?:姓名|名字|電話|手機|信箱|聯絡(?:方式|資料|電話)?|第[一二三四五六七八九十0-9０-９]+位)\s*[:：]?/g;
// 「無」「沒有」等填法不是姓名
const COMPANION_STOPWORD_RE = /^(?:無|沒有|沒|none|n\/a|-+)$/i;

type CompanionEntry = { name: string; phone: string | null; email: string | null };

/** 一段文字 → 同行者（姓名＋可有可無的電話/信箱）。
 *  順序：抽信箱 → 姓名+電話成對抽取 → 殘餘文字切片清洗撿沒電話的姓名。
 *  實例（1shop「同行學員的聯絡資料」欄）：
 *    「張育淇 0930431311」「潘月時／0929723747」
 *    「歐洸熏/0975085939 曾照恩/0932647608」
 *    「總共2位一起上課 第二位：李舜泰 /0968227682 /1993/02/17 台南永康區 信箱：xxx@gmail.com」 */
function parseCompanionEntries(value: string): CompanionEntry[] {
  const entries: CompanionEntry[] = [];
  const pushEntry = (name: string, phone: string | null) => {
    const cleaned = name
      .replace(LABEL_TOKEN_RE, " ")
      .replace(/[()（）]/g, " ")
      .replace(/^[-－\s]+|[-－\s]+$/g, "")
      .trim();
    if (
      cleaned.length >= 2 &&
      cleaned.length <= 40 &&
      !/[@\d]/.test(cleaned) &&
      !COMPANION_STOPWORD_RE.test(cleaned)
    ) {
      entries.push({ name: cleaned, phone, email: null });
      return true;
    }
    return false;
  };

  // 1) 信箱先摘走（生日/地址混在同欄時，殘餘清洗不會誤傷）
  const emails = value.match(EMAIL_IN_TEXT_RE) ?? [];
  let rest = value.replace(EMAIL_IN_TEXT_RE, " ");

  // 2) 姓名+電話成對抽取
  for (const m of rest.matchAll(NAME_PHONE_PAIR_RE)) {
    pushEntry(m[1], normalizeMobile(m[2]));
  }
  rest = rest.replace(NAME_PHONE_PAIR_RE, " ");

  // 3) 殘餘：切片撿沒帶電話的姓名（「同行甲、同行乙」型）；孤立電話補給前一位
  for (const segment of rest.split(/[、,，;；|｜／/\n\r]/)) {
    const phoneMatch = segment.match(PHONE_IN_TEXT_RE);
    const phone = phoneMatch ? normalizeMobile(phoneMatch[0]) : null;
    const ok = pushEntry(segment.replace(PHONE_IN_TEXT_RE, " "), phone);
    if (!ok && phone) {
      const missing = entries.find((e) => !e.phone);
      if (missing) missing.phone = phone;
    }
  }

  // 4) 信箱依序補給還沒有信箱的同行者
  for (const email of emails) {
    const missing = entries.find((e) => !e.email);
    if (missing) missing.email = email;
  }
  return entries;
}

/** 從自訂同行欄位與訂單資訊文字找出同行者。未填就絕不根據數量猜名字。 */
function findCompanions(header: string[], row: unknown[], buyerName: string): CompanionEntry[] {
  const found: CompanionEntry[] = [];
  const add = (value: string) => {
    for (const entry of parseCompanionEntries(value)) {
      if (entry.name === buyerName) continue;
      const existing = found.find((f) => f.name === entry.name);
      if (existing) {
        existing.phone ??= entry.phone;
        existing.email ??= entry.email;
      } else found.push(entry);
    }
  };

  header.forEach((label, index) => {
    const value = String(row[index] ?? "").trim();
    if (!value) return;
    if (COMPANION_HEADER_RE.test(label) && label !== HEADERS.name) add(value);
    if (ORDER_INFO_HEADER_RE.test(label)) {
      for (const match of value.matchAll(COMPANION_IN_TEXT_RE)) add(match[1] ?? "");
    }
  });
  return found;
}

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
  // 1shop「原始訂單資料」近版匯出已超過 60 欄；保留足夠空間給其固定欄位，
  // 仍拒絕不合理的大型寬表，避免異常檔案耗盡解析資源。
  maxCols: 150,
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

export async function parseOrderFile(
  buf: ArrayBuffer,
): Promise<{ rows: ParsedRow[]; mealColumnFound: boolean; quantityColumnFound: boolean }> {
  // 不相信副檔名/瀏覽器 MIME，用 magic bytes 判型：
  //   PK\x03\x04 = zip 容器（xlsx）；D0 CF 11 E0 = 舊版 .xls（拒收）；其他當 CSV 文字
  const head = new Uint8Array(buf.slice(0, 4));
  const isZip = head[0] === 0x50 && head[1] === 0x4b && head[2] === 0x03 && head[3] === 0x04;
  const isLegacyXls =
    head[0] === 0xd0 && head[1] === 0xcf && head[2] === 0x11 && head[3] === 0xe0;
  if (isLegacyXls)
    throw new Error("不支援舊版 .xls 格式，請從 1shop 重新匯出 .xlsx 或 .csv");

  const rows = isZip ? await parseXlsxRows(buf) : parseCsvRows(decodeCsvText(buf));
  if (rows.length < 2)
    return { rows: [], mealColumnFound: false, quantityColumnFound: false };

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

  // 葷素欄：1shop 自訂欄位在匯出檔「每個銷售頁各自成一欄」（實例：AI課程頁
  // 「用餐」、量子2.0頁「課程用餐葷素」），所以收集**所有**命中欄，逐列取
  // 第一個非空值；都空再掃訂單資訊自由文字備援。
  // 排除固定欄位名，防未來改 RE 時誤中「產品」之類
  const fixedLabels = new Set<string>(Object.values(HEADERS));
  const mealCols = header
    .map((label, index) => ({ label, index }))
    .filter(({ label }) => !fixedLabels.has(label) && MEAL_HEADER_RE.test(label))
    .map(({ index }) => index);
  const orderInfoCols = header
    .map((label, index) => ({ label, index }))
    .filter(({ label }) => ORDER_INFO_HEADER_RE.test(label))
    .map(({ index }) => index);
  const findMeal = (r: unknown[]): Meal | null => {
    for (const i of mealCols) {
      const meal = parseMealValue(String(r[i] ?? "").trim());
      if (meal) return meal;
    }
    // 備援：訂單資訊文字裡的「課程用餐葷素： 葷食」——取冒號後的值再判讀
    for (const i of orderInfoCols) {
      const match = String(r[i] ?? "").match(MEAL_IN_TEXT_RE);
      if (match) {
        const meal = parseMealValue(match[1]);
        if (meal) return meal;
      }
    }
    return null;
  };

  const cell = (r: unknown[], i: number | undefined) =>
    i === undefined ? "" : String(r[i] ?? "").trim();

  // 「數量」欄（1shop 匯出名「訂單明細數量」之類）：≥2 而同行者辨識不足時要提醒人工確認
  const qtyCol = header.findIndex((label) => !fixedLabels.has(label) && label.includes("數量"));

  const parsedRows = rows.slice(1).map((r) => {
    const dateStr = cell(r, col.orderedAt);
    const parsed = dateStr ? parseTaipei(dateStr) : null;
    const amountStr = cell(r, col.amount);
    const amount = amountStr ? Math.round(Number(amountStr)) : null;
    const qtyStr = qtyCol >= 0 ? cell(r, qtyCol) : "";
    const qty = qtyStr ? Math.round(Number(qtyStr)) : null;
    const name = cell(r, col.name);
    const companions = findCompanions(header, r, name);
    const unitPriceStr = cell(r, col.unitPrice);
    const unitPrice = unitPriceStr ? Math.round(Number(unitPriceStr)) : null;
    return {
      orderNo: cell(r, col.orderNo),
      orderedAt: parsed && !Number.isNaN(parsed.getTime()) ? parsed : null,
      orderStatus: cell(r, col.orderStatus),
      name,
      product: cell(r, col.product),
      paymentStatus: cell(r, col.paymentStatus),
      phone: cell(r, col.phone),
      email: cell(r, col.email),
      amount: amount !== null && Number.isFinite(amount) ? amount : null,
      meal: findMeal(r),
      paymentMethodRaw: cell(r, col.paymentMethod) || null,
      unitPrice: unitPrice !== null && Number.isFinite(unitPrice) ? unitPrice : null,
      quantity: qty !== null && Number.isFinite(qty) && qty > 0 ? qty : null,
      attendees: [
        { key: "buyer", name },
        ...companions.map((companion, index) => ({
          key: `companion-${index + 1}`,
          name: companion.name,
          phone: companion.phone,
          email: companion.email,
        })),
      ],
    };
  });
  return {
    rows: parsedRows,
    mealColumnFound: mealCols.length > 0,
    quantityColumnFound: qtyCol >= 0,
  };
}

/** 依場次關鍵字歸類並寫入報名（冪等）；回傳匯入報告。
 *
 *  mode="full"（預設）：名單＋金額都寫，名單行為與收支模組上線前完全相同。
 *  mode="financeOnly"：只寫金額（SessionOrder/Line），完全跳過 SessionSignup 的
 *  建立/回填/退款刪除——歷史場次補金額、同一場重傳修正金額的唯一安全路徑，
 *  不會觸發名單端的 dupSkipped 雜訊與退款 deleteMany。 */
export async function importOrders(
  buf: ArrayBuffer,
  opts: { mode?: "full" | "financeOnly"; sourceFile?: string } = {},
): Promise<ImportReport> {
  const mode = opts.mode ?? "full";
  const { rows, mealColumnFound, quantityColumnFound } = await parseOrderFile(buf);
  const sessions = await prisma.courseSession.findMany({
    select: { id: true, title: true, keywords: true },
  });
  const sessionTitle = new Map(sessions.map((s) => [s.id, s.title]));

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
    mealColumnFound,
    mealUnknown: 0,
    companionCheck: [],
    seatOverflow: [],
    dupSkipped: [],
    finance: emptyFinanceReport(),
  };

  // ── 金額第二階段（收支模組）──
  // 與名單階段刻意分家：名單把一張訂單的多明細列合併（席次/同行者語意），
  // 金額必須逐列保留（複訓×2＋新生×1 分兩列的錢不能少一列）。
  // 這段壞掉只影響收支分頁，名單完全不經過這裡。
  try {
    const { drafts, noAmount } = collectOrderFinance(rows, matchSession);
    report.finance.noAmount = noAmount;
    await persistOrderFinance(drafts, report.finance);
    // 收支表底部的「資料來源」列：記下最後一次餵進金額的檔名（LOCKED 場次不動）
    if (opts.sourceFile) {
      const touched = [...new Set(drafts.map((d) => d.sessionId))];
      for (const sid of touched) {
        await prisma.sessionFinance.upsert({
          where: { sessionId: sid },
          update: {},
          create: { sessionId: sid },
        });
        await prisma.sessionFinance.updateMany({
          where: { sessionId: sid, status: { not: "LOCKED" } },
          data: { sourceFile: opts.sourceFile },
        });
      }
    }
    await markRefundedOrders(
      rows
        .filter(
          (r) =>
            r.orderNo &&
            (r.orderStatus.includes("取消") || r.paymentStatus.includes("退款")),
        )
        .map((r) => ({
          orderNo: r.orderNo,
          product: r.product,
          amount: r.amount,
          name: r.name,
        })),
      matchSession,
      report.finance,
    );
  } catch (e) {
    // 金額階段失敗不能拖垮名單匯入——上課通知比收支報表緊急
    console.error("[session-finance-import] 金額階段失敗（名單不受影響）：", e);
  }

  // financeOnly：到此為止，完全不碰 SessionSignup（歷史補金額/重傳修正金額用）
  if (mode === "financeOnly") return report;
  const unmatchedRows = new Map<string, UnmatchedOrderRow[]>();
  const toCreate: {
    sessionId: string;
    orderNo: string;
    attendeeKey: string;
    name: string;
    email: string | null;
    phone: string | null;
    product: string;
    amount: number | null;
    orderedAt: Date | null;
    meal: Meal | null;
  }[] = [];
  // 同一張訂單在同一場次的所有明細列合併成一筆（席次加總、同行者去重）
  const orders = new Map<
    string,
    {
      sessionId: string;
      orderNo: string;
      buyerName: string;
      email: string | null;
      phone: string | null;
      product: string;
      amount: number | null;
      orderedAt: Date | null;
      meal: Meal | null;
      seats: number;
      companions: OrderAttendee[];
    }
  >();
  const cancelOrderNos: string[] = [];
  // 已匯入過的列 createMany 會略過不更新——葷素另外回填（只補 meal 仍空的列，
  // 不覆蓋後台手動標記；orderNo 全域唯一所以跨場次含延期列都會補到）
  const mealBackfill: Record<Meal, string[]> = { VEG: [], MEAT: [] };

  for (const row of rows) {
    if (!row.orderNo || !row.name) {
      // 1shop 匯出檔末尾的「總計」列不是資料，不計入噪音
      if (!/總計/.test(row.orderNo)) report.invalid++;
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
        meal: row.meal,
        seats: quantityColumnFound ? (row.quantity ?? 1) : null,
        attendees: row.attendees,
      });
      unmatchedRows.set(row.product, list);
      continue;
    }
    if (mealColumnFound && row.meal === null) report.mealUnknown++;
    if (row.meal) mealBackfill[row.meal].push(row.orderNo);

    // 一張訂單在同一場次可能有多筆明細列（實例：莊秀玲「複訓×2 + 新生×1」＝3 席，
    // 分兩列匯出且兩列的同行欄內容相同）。席次與同行者都要**按訂單加總**再決定
    // 建幾列——逐列判斷會把第 3 位丟掉。
    const key = `${sessionId}|${row.orderNo}`;
    const g = orders.get(key) ?? {
      sessionId,
      orderNo: row.orderNo,
      buyerName: row.name,
      email: row.email || null,
      // 買家主號接受海外門號（存 E.164）。
      // 同行者欄位（自由文字，走 PHONE_IN_TEXT_RE / NAME_PHONE_PAIR_RE）刻意仍只認
      // 09 開頭台灣號：在一團自由文字裡辨識國際號碼太容易誤抓，寧可漏掉讓管理員
      // 事後用名單的逐人補號碼補（那條路已接受海外號），也不要抓錯一個號碼。
      phone: normalizeContactPhone(row.phone),
      product: row.product,
      amount: row.amount,
      orderedAt: row.orderedAt,
      meal: row.meal,
      seats: 0,
      companions: [] as OrderAttendee[],
    };
    g.seats += row.quantity ?? 1;
    g.meal ??= row.meal;
    for (const a of row.attendees) {
      if (a.key === "buyer" || !a.name) continue;
      const same = g.companions.find((c) => c.name === a.name);
      if (same) {
        same.phone ??= a.phone ?? null;
        same.email ??= a.email ?? null;
      } else g.companions.push({ ...a });
    }
    orders.set(key, g);
  }

  for (const g of orders.values()) {
    // 席次 = 買了幾個位子；訂購人佔 1 席，其餘才是同行者。
    // 席次 1 卻在同行欄填了名字＝「我跟某某一起上課」（對方多半自己下單），
    // 不是多買一個位子——照建列會把人數灌水，也是名單重複的來源。
    // 沒有數量欄的舊匯出檔（辨識不到席次）維持原行為，全部收下。
    const allowed = quantityColumnFound ? Math.max(0, g.seats - 1) : g.companions.length;
    const taken = g.companions.slice(0, allowed);
    const dropped = g.companions.slice(allowed);
    if (dropped.length > 0) {
      report.seatOverflow.push({
        orderNo: g.orderNo,
        name: g.buyerName,
        seats: g.seats,
        dropped: dropped.map((d) => d.name),
        sessionTitle: sessionTitle.get(g.sessionId) ?? "",
      });
    }
    // 席次比辨識到的人多 → 同行者沒填或格式認不得，列出來人工補
    if (quantityColumnFound && g.seats >= 2 && 1 + taken.length < g.seats) {
      report.companionCheck.push({
        orderNo: g.orderNo,
        name: g.buyerName,
        quantity: g.seats,
        found: 1 + taken.length,
      });
    }
    const attendees: OrderAttendee[] = [
      { key: "buyer", name: g.buyerName, phone: g.phone, email: g.email },
      // 重新編號：席次上限砍掉的人不佔號，companion-N 才不會跳號
      ...taken.map((c, i) => ({ ...c, key: `companion-${i + 1}` })),
    ];
    for (const a of attendees) {
      toCreate.push({
        sessionId: g.sessionId,
        orderNo: g.orderNo,
        attendeeKey: a.key,
        name: a.name,
        // 同行者的手機/信箱若有填在同行欄就帶入（收上課提醒簡訊）
        email: a.email ?? null,
        phone: a.phone ?? null,
        product: g.product,
        amount: g.amount,
        orderedAt: g.orderedAt,
        // 葷素是訂購人填的；同行者吃什麼未知，留未標由後台補
        meal: a.key === "buyer" ? g.meal : null,
      });
    }
  }

  if (cancelOrderNos.length > 0) {
    const del = await prisma.sessionSignup.deleteMany({
      where: { orderNo: { in: cancelOrderNos } },
    });
    report.canceledRemoved = del.count;
  }
  if (toCreate.length > 0) {
    // 重複防線分兩層：
    //  1) 唯一鍵（場次+訂單編號+參加者鍵）——同一張訂單重匯，交給 skipDuplicates
    //  2) 同場次同一人但訂單編號不同（手動先補、同一人下兩張單、同行者又自己下單）
    //     ——唯一鍵抓不到，這裡靠姓名＋手機比對擋掉，並列進報告
    // 撈這批會動到的場次全部名單（判重複用）＋同訂單編號的列（延期複本也要回填空欄位）
    const existing = await prisma.sessionSignup.findMany({
      where: {
        OR: [
          { sessionId: { in: [...new Set(toCreate.map((t) => t.sessionId))] } },
          { orderNo: { in: [...new Set(toCreate.map((t) => t.orderNo))] } },
        ],
      },
      select: {
        id: true, sessionId: true, orderNo: true, attendeeKey: true,
        name: true, phone: true, email: true, deferredToSessionId: true,
      },
    });
    type ExistingRow = (typeof existing)[number];
    const byTriple = new Set(
      existing.map((e) => `${e.sessionId}|${e.orderNo}|${e.attendeeKey}`),
    );
    // 同一張訂單的同一位參加者可能有多列（延期時原場次留一列、目標場次一列）
    const byPair = new Map<string, ExistingRow[]>();
    for (const e of existing) {
      const key = `${e.orderNo}|${e.attendeeKey}`;
      byPair.set(key, [...(byPair.get(key) ?? []), e]);
    }
    // 各場次「已在名單的人」；延出者不算——人不來這場了，重新報名要能建新列
    const roster = new Map<string, { name: string; phone: string | null; orderNo: string; row?: ExistingRow }[]>();
    for (const e of existing) {
      if (e.deferredToSessionId) continue;
      const list = roster.get(e.sessionId) ?? [];
      list.push({ name: e.name, phone: e.phone, orderNo: e.orderNo, row: e });
      roster.set(e.sessionId, list);
    }

    // 既有列的空欄位回填（只補 null，不覆蓋任何已填值——後台手改過的一律保留）
    const fills = new Map<string, { phone?: string; email?: string }>();
    const planFill = (row: ExistingRow, t: (typeof toCreate)[number]) => {
      const data = fills.get(row.id) ?? {};
      if (!row.phone && t.phone) data.phone = t.phone;
      if (!row.email && t.email) data.email = t.email;
      if (data.phone || data.email) fills.set(row.id, data);
    };

    const kept: typeof toCreate = [];
    for (const t of toCreate) {
      if (byTriple.has(`${t.sessionId}|${t.orderNo}|${t.attendeeKey}`)) {
        for (const row of byPair.get(`${t.orderNo}|${t.attendeeKey}`) ?? []) planFill(row, t);
        kept.push(t); // 同鍵：留給 skipDuplicates 計入「已在名單」
        continue;
      }
      const people = roster.get(t.sessionId) ?? [];
      const dup = people.find((p) => isSamePerson(p, t));
      if (dup) {
        report.dupSkipped.push({
          name: t.name,
          orderNo: t.orderNo,
          existingOrderNo: dup.orderNo,
          sessionTitle: sessionTitle.get(t.sessionId) ?? "",
        });
        if (dup.row) planFill(dup.row, t);
        continue;
      }
      // 同一檔案裡的重複（同一人兩張單）也要擋：接受的人即時進名單
      people.push({ name: t.name, phone: t.phone, orderNo: t.orderNo });
      roster.set(t.sessionId, people);
      kept.push(t);
    }

    const res = await prisma.sessionSignup.createMany({
      data: kept,
      skipDuplicates: true,
    });
    report.imported = res.count;
    report.duplicate = kept.length - res.count + report.dupSkipped.length;
    if (fills.size > 0) {
      await prisma.$transaction(
        [...fills.entries()].map(([id, data]) =>
          prisma.sessionSignup.update({ where: { id }, data }),
        ),
      );
    }
  }
  // 葷素回填既有列：meal IS NULL 條件保證不覆蓋後台手動標記
  for (const meal of ["VEG", "MEAT"] as const) {
    if (mealBackfill[meal].length === 0) continue;
    await prisma.sessionSignup.updateMany({
      where: { orderNo: { in: mealBackfill[meal] }, attendeeKey: "buyer", meal: null },
      data: { meal },
    });
  }
  report.unmatched = [...unmatchedRows.entries()]
    .map(([product, rows]) => ({ product, count: rows.length, rows }))
    .sort((a, b) => b.count - a.count);
  return report;
}
