// 簡訊字數／則數計算與合規文案組裝。
//
// 純同步、不 import "server-only"：後台表單（client）要即時顯示字數與預估金額，
// 發送端（server-only）要算實際則數——兩邊必須用同一支函式，
// 否則預覽的則數會跟帳單對不起來（同 previewGroupAudience 與寄送共用解析路徑的道理）。

/** 純英數（GSM-7）：單則 160 字，分段後每段 153 */
export const GSM_SINGLE = 160;
export const GSM_MULTI = 153;
/** 含中文（UCS-2）：單則 70 字，分段後每段 67。台灣簡訊商以此計費 */
export const UCS2_SINGLE = 70;
export const UCS2_MULTI = 67;

/** GSM-7 基本字集；不在此集合內的字元（中文、全形標點等）會讓整則升級成 UCS-2 */
const GSM_BASIC = /^[ -~ -ÿ\n\r\t€£¥èéùìòÇØøÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉÄÖÑÜ§¿äöñüà]*$/;
/** GSM-7 擴充字元：佔 2 個字元的額度 */
const GSM_EXTENDED = /[\^{}\[\]~\\|€]/g;

/** 內文禁用 emoji：代理對若跨越分段邊界會被電信業者移位，
 *  實際則數可能比公式多一段（＝多一筆錢）。與其建模，不如擋掉——
 *  台灣各電信商對 emoji 的呈現本來就不一致。 */
const EMOJI_RE =
  /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{1F1E6}-\u{1F1FF}]/u;

export type SmsCount = {
  encoding: "GSM7" | "UCS2";
  length: number; // 計費字元數
  segments: number;
  perSegment: number; // 目前分段容量（UI 顯示「還可打 N 字」用）
  remaining: number; // 本段還可打幾字
};

export function countSms(text: string): SmsCount {
  const isGsm = GSM_BASIC.test(text);

  // 計費以 UTF-16 code unit 為準（電信業者算法），不是 [...text].length——
  // 那會把代理對算成 1，實際計費是 2。
  const length = isGsm
    ? text.length + (text.match(GSM_EXTENDED)?.length ?? 0)
    : text.length;

  const single = isGsm ? GSM_SINGLE : UCS2_SINGLE;
  const multi = isGsm ? GSM_MULTI : UCS2_MULTI;

  const segments = length === 0 ? 0 : length <= single ? 1 : Math.ceil(length / multi);
  const perSegment = segments <= 1 ? single : multi;

  return {
    encoding: isGsm ? "GSM7" : "UCS2",
    length,
    segments,
    perSegment,
    remaining: Math.max(0, segments <= 1 ? single - length : segments * multi - length),
  };
}

export function hasEmoji(text: string): boolean {
  return EMOJI_RE.test(text);
}

/** {name} / {mobile} 變數替換（對照 email 的 applyMergeTags） */
export function applySmsMergeTags(
  text: string,
  r: { mobile: string; name?: string },
): string {
  return text.replace(/\{name\}/g, r.name ?? "").replace(/\{mobile\}/g, r.mobile);
}

/** 預覽用的等長佔位退訂網址：短碼固定 8 碼，佔位字數與實際完全相同，
 *  所以預覽算出來的則數就是實際發送的則數 */
export const OPTOUT_URL_PLACEHOLDER = "https://course.huangxi.info/u/XXXXXXXX";

/** 合規文案組裝：品牌前綴 ＋ 內文 ＋（僅行銷簡訊的）退訂 footer。
 *
 *  NCC 規定商業簡訊須標示來源並提供免費退訂方式；履約通知（上課提醒）不適用，
 *  也不該帶退訂連結——學員退訂行銷不代表放棄自己付費課程的上課通知。 */
export function composeSmsText(
  body: string,
  o: {
    messageType: "MARKETING" | "NOTICE";
    brandPrefix: string;
    optOutUrl?: string | null;
  },
): string {
  const prefix = o.brandPrefix ? `${o.brandPrefix}` : "";
  const footer =
    o.messageType === "MARKETING" && o.optOutUrl ? `\n拒收 ${o.optOutUrl}` : "";
  return `${prefix}${body}${footer}`;
}
