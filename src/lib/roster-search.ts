// 名單搜尋比對規則：看板（/board）與後台場次（/admin/sessions）共用同一套語意，
// 免得同一個關鍵字在兩邊查出不同結果。純函式，無 DOM 依賴。

import { isRetrainSignup, type RetrainLike } from "./session-roster";

/** 搜尋比對用的正規化：只去空白＋英文小寫。
 *  刻意**不用** normalizePersonName——那支會把括號註記整段刪掉（去重比對用），
 *  但「Polly cheng（鄭寶莉）」正是要能用「鄭寶莉」搜到，括號內容不能丟。 */
export function normalizeQuery(s: string | null | undefined): string {
  return (s ?? "").replace(/\s+/g, "").toLowerCase();
}

/** 這個關鍵字夠不夠具體，值得送出查詢？
 *
 *  中文一個字就有篩選力（姓氏——正式站光是姓陳的會員就有 53 位，
 *  「陳」是完全合理的查詢起點），英數則至少要兩個字元，
 *  否則「a」會把幾百筆全撈回來，等於沒篩。
 *  客戶端的輸入閘門與伺服器端的查詢閘門共用這一支，兩邊門檻才不會不一致。 */
export function isSearchableQuery(q: string | null | undefined): boolean {
  const t = (q ?? "").trim();
  if (!t) return false;
  // CJK 統一表意文字（含擴充 A）與相容表意文字
  return /[\u3400-\u9fff\uf900-\ufaff]/.test(t) ? t.length >= 1 : t.length >= 2;
}

/** 任一欄位含關鍵字即命中。query 必須是 normalizeQuery 過的字串。 */
export function matchesText(query: string, ...fields: (string | null | undefined)[]): boolean {
  return fields.some((f) => f && normalizeQuery(f).includes(query));
}

export type TaggableSignup = RetrainLike & {
  meal: string | null;
  isStaff?: boolean;
  groupNo?: number | null;
};

/** 組別關鍵字：「3組」「第3組」→ 第 3 組。 */
const GROUP_QUERY_RE = /^第?(\d{1,3})組$/;

/** 身分／餐別／組別關鍵字：**只在整串完全相等時**才當篩選條件。
 *  用 includes 會壞事——「素」「芬」這類字常出現在姓名裡（陳素娥、張淑芬），
 *  查人名時不該把全場素食者一起撈出來。 */
export function matchesTag(query: string, g: TaggableSignup): boolean {
  const group = GROUP_QUERY_RE.exec(query);
  if (group) return g.groupNo === Number(group[1]);
  switch (query) {
    case "素":
    case "素食":
      return g.meal === "VEG";
    case "葷":
    case "葷食":
      return g.meal !== "VEG";
    case "複訓":
    case "舊生":
      return !g.isStaff && isRetrainSignup(g);
    case "新生":
      return !g.isStaff && !isRetrainSignup(g);
    case "工作人員":
      return !!g.isStaff;
    case "未分組":
      return !g.isStaff && g.groupNo == null;
    default:
      return false;
  }
}
