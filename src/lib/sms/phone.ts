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

/** 海外門號的存放格式：E.164（+ 開頭，國碼含號碼 7–15 碼）。
 *  只有會員自己在註冊／補填頁填的號碼會是這個格式，匯入名單一律仍是台灣號。 */
export const INTL_PHONE_RE = /^\+\d{7,15}$/;

export type MobileReject =
  | "EMPTY" // 空白
  | "LANDLINE" // 市話（收不到簡訊）
  | "TOO_SHORT"
  | "TOO_LONG" // 含分機、一格兩號等
  | "OVERSEAS" // 海外門號：不是錯誤，是本模組不處理（上課通知走 Email）
  | "FORMAT"; // 其他無法辨識

/** 把各種寫法的台灣手機號碼轉成標準的 09XXXXXXXX；無法辨識回 null */
export function normalizeMobile(raw: unknown): string | null {
  return explainMobile(raw).mobile;
}

/** 同 normalizeMobile，但附上被拒絕的理由。
 *  匯入報告與表單錯誤訊息要用——「02 開頭是市話，簡訊送不到」比「格式錯誤」有用得多。
 *
 *  reject 為 OVERSEAS 時額外附上 overseas（E.164）——海外門號不是「壞掉的輸入」，
 *  是本模組不處理的有效號碼，註冊／補填表單要能拿到它存起來。 */
export function explainMobile(raw: unknown): {
  mobile: string | null;
  reject?: MobileReject;
  overseas?: string;
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

  // 海外門號判定的兩個素材，都要在 d 被下面的台灣號規則改寫之前取好：
  // intl＝輸入是否帶明確的國際冠碼（+ 或 00）。這是「海外號」與「打錯的台灣號」
  // 唯一的判準——刻意只認明確訊號、不用長度猜：091234567（少一碼）必須繼續被擋成
  // 錯誤，不可以被當成國碼 91 的海外號悄悄放行。
  const intl = s.trim().startsWith("+") || d.startsWith("00");
  const d0 = d;

  // 國際冠碼 +886 / 886 / 00886 / 002886 → 剝除後補回本地的 0
  const stripped = d.replace(/^(?:00|002)?886/, "");
  if (stripped !== d) d = stripped.startsWith("0") ? stripped : "0" + stripped;

  // Excel / CSV 吃掉前導 0：9 碼且以 9 開頭才補。
  // 9 碼但以 2 開頭（市話掉零，如 227001234）刻意不補——補了就變成一個錯的手機號碼。
  if (d.length === 9 && d.startsWith("9")) d = "0" + d;

  if (TW_MOBILE_RE.test(d)) return { mobile: d };

  // 走到這裡都是失敗，給出具體理由。
  // 海外門號排在長度判斷之前：+60123456789 是有效號碼，
  // 報成「號碼過長」會害操作人員去追一個根本不存在的錯誤。
  // 886 開頭一律不算海外——+886 的東西若沒能在上面被認成台灣號，
  // 那就是一個壞掉的台灣號，該去撞原本的錯誤訊息，不該被包裝成合法海外號。
  if (intl) {
    const digits = d0.replace(/^(?:00|002)/, "");
    const e164 = "+" + digits;
    if (!digits.startsWith("886") && INTL_PHONE_RE.test(e164))
      return { mobile: null, reject: "OVERSEAS", overseas: e164 };
  }
  if (/^0[2-8]/.test(d)) return { mobile: null, reject: "LANDLINE" };
  if (d.length < 10) return { mobile: null, reject: "TOO_SHORT" };
  if (d.length > 10) return { mobile: null, reject: "TOO_LONG" };
  return { mobile: null, reject: "FORMAT" };
}

/** 海外門號正規化 → E.164（+60123456789）；不是海外門號回 null。
 *  與 normalizeMobile 是一組：一個輸入最多只會有一邊回非 null。 */
export function normalizeInternational(raw: unknown): string | null {
  return explainMobile(raw).overseas ?? null;
}

/** 這個號碼是不是海外門號（存成 E.164 的那些）。
 *  後台名單、簽到表要用來標示「這個人不寄簡訊，上課通知走 Email」。 */
export function isOverseasPhone(p: string | null | undefined): boolean {
  return !!p && INTL_PHONE_RE.test(p);
}

export const MOBILE_REJECT_LABEL: Record<MobileReject, string> = {
  EMPTY: "未填寫",
  LANDLINE: "市話號碼（簡訊送不到）",
  TOO_SHORT: "號碼長度不足",
  TOO_LONG: "號碼過長（可能含分機或一格填了兩個號碼）",
  OVERSEAS: "海外門號（不發國際簡訊，上課通知以 Email 寄送）",
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
