// 場次名冊領域邏輯：新舊生判別、葷素、統計、自動分組。
// 純函式、不掛 server-only——scripts/test-session-roster.ts 用 tsx 直測
// （同 session-import.ts 不掛 server-only 的理由）。

export type Meal = "VEG" | "MEAT";

/** 舊生判別全站統一規則：產品名含「複訓」（手動新增舊生時寫入端也會補這個標記） */
export function isRetrainProduct(product: string | null | undefined): boolean {
  return !!product?.includes("複訓");
}

/** 1shop 訂單檔的葷素欄位名。每個銷售頁的自訂欄位在匯出檔**各自成一欄**
 *  （實例：AI課程頁「用餐」、量子2.0頁「課程用餐葷素」），所以匯入端要
 *  收集**所有**命中的欄，逐列取第一個非空值，不能只讀第一欄。 */
export const MEAL_HEADER_RE = /餐點|用餐|葷素|素食|葷食|飲食/;

/** 訂單資訊自由文字裡的葷素標註（例：「課程用餐葷素： 葷食」）——取冒號後的值。
 *  不能整串丟 parseMealValue：「葷素」兩字含「素」，整串比對會把葷食誤判成素。 */
export const MEAL_IN_TEXT_RE = /(?:葷素|用餐|餐點|飲食)[^:：\n]*[:：]\s*([^\s，,;；、|]+)/;

/** 值含「素」→ 素；其他非空 → 葷；空 → null（未標）。
 *  「不吃素」會被誤判成素——後台可逐人切換，是可接受的取捨。 */
export function parseMealValue(value: string | null | undefined): Meal | null {
  const v = value?.trim();
  if (!v) return null;
  return v.includes("素") ? "VEG" : "MEAT";
}

export function mealLabel(meal: string | null | undefined): string {
  if (meal === "VEG") return "素";
  if (meal === "MEAT") return "葷";
  return "葷（未標）";
}

export type RosterSignup = {
  product: string | null;
  meal: string | null;
  deferredToSessionId: string | null;
  groupNo: number | null;
};

export type RosterStats = {
  total: number; // 有效人數（不含延出）
  fresh: number;
  retrain: number;
  veg: number;
  meat: number; // 含未標（訂餐數字往安全側算）
  mealUnknown: number;
  deferredOut: number;
  ungrouped: number; // 有效但尚未分組
};

export function computeRosterStats(signups: RosterSignup[]): RosterStats {
  const stats: RosterStats = {
    total: 0, fresh: 0, retrain: 0, veg: 0, meat: 0, mealUnknown: 0, deferredOut: 0, ungrouped: 0,
  };
  for (const s of signups) {
    if (s.deferredToSessionId) {
      stats.deferredOut++;
      continue;
    }
    stats.total++;
    if (isRetrainProduct(s.product)) stats.retrain++;
    else stats.fresh++;
    if (s.meal === "VEG") stats.veg++;
    else {
      stats.meat++;
      if (s.meal !== "MEAT") stats.mealUnknown++;
    }
    if (s.groupNo == null) stats.ungrouped++;
  }
  return stats;
}

export const MIN_GROUPS = 6; // 總組數從 6 組起跳（Jason 定的規則）

/** 組數 = max(6, ⌈有效人數/每組上限⌉) */
export function groupCountFor(activeCount: number, cap: number): number {
  const safeCap = Math.max(1, Math.floor(cap));
  return Math.max(MIN_GROUPS, Math.ceil(activeCount / safeCap));
}

export type GroupableSignup = {
  id: string;
  product: string | null;
  deferredToSessionId: string | null;
  orderedAt: Date | null;
  createdAt: Date;
};

/** 自動分組：延出者排除；新生、舊生各自依 orderedAt/createdAt/id 穩定排序後
 *  round-robin 散進各組（舊生從新生停下的游標接續）——各組人數差 ≤1，
 *  且新舊比例鏡射整體名單（名單是 6:4 每組就約 6:4）。確定性：同輸入必同輸出。 */
export function assignGroups(
  signups: GroupableSignup[],
  cap: number,
): { assignments: Map<string, number>; groupCount: number } {
  const active = signups.filter((s) => !s.deferredToSessionId);
  const groupCount = groupCountFor(active.length, cap);
  const byTime = (a: GroupableSignup, b: GroupableSignup) => {
    const ta = a.orderedAt?.getTime() ?? a.createdAt.getTime();
    const tb = b.orderedAt?.getTime() ?? b.createdAt.getTime();
    return ta - tb || a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id);
  };
  const fresh = active.filter((s) => !isRetrainProduct(s.product)).sort(byTime);
  const retrain = active.filter((s) => isRetrainProduct(s.product)).sort(byTime);

  const assignments = new Map<string, number>();
  let cursor = 0;
  for (const s of [...fresh, ...retrain]) {
    assignments.set(s.id, (cursor % groupCount) + 1);
    cursor++;
  }
  return { assignments, groupCount };
}
