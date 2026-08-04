// 台灣手機號碼正規化 —— 簡訊模組的 dedupeByEmail 對應物。
//
// 標準格式：本地 10 碼 09XXXXXXXX（不用 E.164）。理由見 docs/sms-module.md，
// 簡言之：現有資料已是這個格式（零遷移）、簡訊商 API 也吃這個格式、
// 而且去重鍵＝顯示值＝人工輸入值，只有一種表示法要記。
//
// 純同步、無副作用、刻意不 import "server-only"——
// "use server" action、server-only 的 dispatch、client 表單三邊都要 import
//（同 email/audience.ts、email/followup.ts 的既有做法）。
//
// 設計原則：這是會花錢的模組，遇到模稜兩可一律「拒絕」而不是「猜」。
// 每一筆無法辨識的輸入都會變成畫面上可見的「N 筆無法辨識」，而不是一則寄到錯號碼的簡訊。

export const TW_MOBILE_RE = /^09\d{8}$/;

export type MobileReject =
  | "EMPTY" // 空白
  | "LANDLINE" // 市話（收不到簡訊）
  | "TOO_SHORT"
  | "TOO_LONG" // 含分機、一格兩號等
  | "FORMAT"; // 其他無法辨識

/** 把各種寫法的台灣手機號碼轉成標準的 09XXXXXXXX；無法辨識回 null */
export function normalizeMobile(raw: unknown): string | null {
  return explainMobile(raw).mobile;
}

/** 同 normalizeMobile，但附上被拒絕的理由。
 *  匯入報告與表單錯誤訊息要用——「02 開頭是市話，簡訊送不到」比「格式錯誤」有用得多。 */
export function explainMobile(raw: unknown): {
  mobile: string | null;
  reject?: MobileReject;
} {
  if (typeof raw !== "string" && typeof raw !== "number")
    return { mobile: null, reject: "EMPTY" };

  let s = String(raw);

  // 全形數字與全形加號 → 半形（Excel、LINE 複製貼上很常見）
  s = s.replace(/[\uFF10-\uFF19]/g, (c) =>
    String.fromCharCode(c.charCodeAt(0) - 0xff10 + 0x30),
  );
  s = s.replace(/\uFF0B/g, "+");
  // 零寬字元與不斷行空白（與 admin.ts parseRows 的清洗規則一致）；
  // 一律用跳脫寫法：這些字元在編輯器裡看不見，寫成字面量會變成無法維護的地雷
  s = s.replace(/[\u200B-\u200D\uFEFF]/g, "").replace(/\u00A0/g, " ");

  if (!s.trim()) return { mobile: null, reject: "EMPTY" };

  // 只留數字：- ( ) . 空白 全形括號等分隔符一律丟棄
  let d = s.replace(/\D/g, "");
  if (!d) return { mobile: null, reject: "FORMAT" };

  // 國際冠碼 +886 / 886 / 00886 / 002886 → 剝除後補回本地的 0
  const stripped = d.replace(/^(?:00|002)?886/, "");
  if (stripped !== d) d = stripped.startsWith("0") ? stripped : "0" + stripped;

  // Excel / CSV 吃掉前導 0：9 碼且以 9 開頭才補。
  // 9 碼但以 2 開頭（市話掉零，如 227001234）刻意不補——補了就變成一個錯的手機號碼。
  if (d.length === 9 && d.startsWith("9")) d = "0" + d;

  if (TW_MOBILE_RE.test(d)) return { mobile: d };

  // 走到這裡都是失敗，給出具體理由
  if (/^0[2-8]/.test(d)) return { mobile: null, reject: "LANDLINE" };
  if (d.length < 10) return { mobile: null, reject: "TOO_SHORT" };
  if (d.length > 10) return { mobile: null, reject: "TOO_LONG" };
  return { mobile: null, reject: "FORMAT" };
}

export const MOBILE_REJECT_LABEL: Record<MobileReject, string> = {
  EMPTY: "未填寫",
  LANDLINE: "市話號碼（簡訊送不到）",
  TOO_SHORT: "號碼長度不足",
  TOO_LONG: "號碼過長（可能含分機或一格填了兩個號碼）",
  FORMAT: "格式無法辨識",
};

/** 後台顯示用：0912345678 → 0912-345-678。非標準格式原樣回傳，不強行切 */
export function formatMobile(m: string | null | undefined): string {
  if (!m) return "—";
  return TW_MOBILE_RE.test(m) ? `${m.slice(0, 4)}-${m.slice(4, 7)}-${m.slice(7)}` : m;
}

/** 退訂頁顯示用的遮罩：0912345678 → 0912-***-678
 *  短碼萬一外流或被猜到，也不會洩漏完整號碼 */
export function maskMobile(m: string): string {
  return TW_MOBILE_RE.test(m) ? `${m.slice(0, 4)}-***-${m.slice(7)}` : "****";
}
