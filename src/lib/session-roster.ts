// 場次名冊領域邏輯：新舊生判別、葷素、統計、自動分組。
// 純函式、不掛 server-only——scripts/test-session-roster.ts 用 tsx 直測
// （同 session-import.ts 不掛 server-only 的理由）。

export type Meal = "VEG" | "MEAT";

/** 舊生判別全站統一規則：產品名含「複訓」（手動新增舊生時寫入端也會補這個標記） */
export function isRetrainProduct(product: string | null | undefined): boolean {
  return !!product?.includes("複訓");
}

export type RetrainLike = { product: string | null; isRetrain?: boolean | null };

/** 逐人的新舊生判定：管理員在後台改過（isRetrain 非 null）就以人工為準，
 *  否則回退到產品名判別。**所有**顯示／統計／分組一律走這裡，別直接讀 product。 */
export function isRetrainSignup(s: RetrainLike): boolean {
  return s.isRetrain ?? isRetrainProduct(s.product);
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

/** 人別比對用的姓名正規化：去空白、去括號註記（管理員常補「Polly cheng（鄭寶莉）」）、
 *  英文一律小寫。只用於重複偵測，不動顯示用的姓名。 */
export function normalizePersonName(name: string | null | undefined): string {
  return (name ?? "")
    .replace(/[（(][^）)]*[）)]/g, "")
    .replace(/\s+/g, "")
    .toLowerCase();
}

export type PersonLike = { name: string; phone?: string | null };

/** 同一場次內是不是同一個人（跨訂單編號的重複判定）：
 *  姓名（正規化後）相同 且 手機沒有互相矛盾 → 同一人。
 *  兩邊手機都有且不同 → 同名的不同人，各自入列。
 *  不用「手機相同」當主判準的理由：團報／手動補的名單整批沒手機，靠手機認不出人。 */
export function isSamePerson(a: PersonLike, b: PersonLike): boolean {
  const key = normalizePersonName(a.name);
  if (!key || key !== normalizePersonName(b.name)) return false;
  const pa = a.phone?.trim();
  const pb = b.phone?.trim();
  return !(pa && pb && pa !== pb);
}

export type RosterSignup = {
  product: string | null;
  isRetrain?: boolean | null;
  meal: string | null;
  deferredToSessionId: string | null;
  groupNo: number | null;
  isStaff?: boolean;
};

export type RosterStats = {
  total: number; // 學員數（不含延出、不含工作人員）
  fresh: number;
  retrain: number;
  staff: number; // 工作人員（不分組、不算新舊生，但用餐要算）
  veg: number; // 用餐統計含工作人員
  meat: number; // 含未標（訂餐數字往安全側算）
  mealUnknown: number;
  deferredOut: number;
  ungrouped: number; // 學員中尚未分組者（工作人員不算）
};

export function computeRosterStats(signups: RosterSignup[]): RosterStats {
  const stats: RosterStats = {
    total: 0, fresh: 0, retrain: 0, staff: 0,
    veg: 0, meat: 0, mealUnknown: 0, deferredOut: 0, ungrouped: 0,
  };
  for (const s of signups) {
    if (s.deferredToSessionId) {
      stats.deferredOut++;
      continue;
    }
    // 用餐統計含工作人員（訂便當是全場的量）
    if (s.meal === "VEG") stats.veg++;
    else {
      stats.meat++;
      if (s.meal !== "MEAT") stats.mealUnknown++;
    }
    if (s.isStaff) {
      stats.staff++;
      continue;
    }
    stats.total++;
    if (isRetrainSignup(s)) stats.retrain++;
    else stats.fresh++;
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
  isRetrain?: boolean | null;
  deferredToSessionId: string | null;
  orderedAt: Date | null;
  createdAt: Date;
  isStaff?: boolean; // 工作人員不列入分組
};

/** 第 g 組的實際上限：逐組覆寫（groupCaps，0 或缺值 = 用預設）優先於預設值 */
export function capForGroup(g: number, defaultCap: number, groupCaps: number[] = []): number {
  const override = groupCaps[g - 1];
  return override && override > 0 ? override : Math.max(1, Math.floor(defaultCap));
}

/** 補分組：只分「未分組」的人，已分好的組別完全不動（每日更新名單後的新報名用）。
 *  逐人挑「同類（新生/舊生）人數最少 → 總人數最少 → 組號最小」且未滿上限的組，
 *  全部組都滿了才開新組——維持各組人數與新舊比大致均衡。
 *  回傳的 assignments 只含這次補進去的人。 */
export function assignRemaining(
  signups: (GroupableSignup & { groupNo: number | null })[],
  cap: number,
  groupCaps: number[] = [],
): { assignments: Map<string, number>; groupCount: number } {
  const active = signups.filter((s) => !s.deferredToSessionId && !s.isStaff);
  const grouped = active.filter((s) => s.groupNo != null);
  // 還沒分過組 → 等同全量分組
  if (grouped.length === 0) return assignGroups(active, cap, groupCaps);

  let groupCount = Math.max(MIN_GROUPS, ...grouped.map((s) => s.groupNo!));
  const stats = new Map<number, { total: number; fresh: number; retrain: number }>();
  for (let g = 1; g <= groupCount; g++) stats.set(g, { total: 0, fresh: 0, retrain: 0 });
  for (const s of grouped) {
    const st = stats.get(s.groupNo!) ?? { total: 0, fresh: 0, retrain: 0 };
    st.total++;
    if (isRetrainSignup(s)) st.retrain++;
    else st.fresh++;
    stats.set(s.groupNo!, st);
  }

  const byTime = (a: GroupableSignup, b: GroupableSignup) => {
    const ta = a.orderedAt?.getTime() ?? a.createdAt.getTime();
    const tb = b.orderedAt?.getTime() ?? b.createdAt.getTime();
    return ta - tb || a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id);
  };
  const ungrouped = active.filter((s) => s.groupNo == null).sort(byTime);

  const assignments = new Map<string, number>();
  for (const s of ungrouped) {
    const retrain = isRetrainSignup(s);
    let best: number | null = null;
    for (let g = 1; g <= groupCount; g++) {
      const st = stats.get(g)!;
      if (st.total >= capForGroup(g, cap, groupCaps)) continue;
      if (best === null) {
        best = g;
        continue;
      }
      const bs = stats.get(best)!;
      const cat = (x: typeof st) => (retrain ? x.retrain : x.fresh);
      if (cat(st) < cat(bs) || (cat(st) === cat(bs) && st.total < bs.total)) best = g;
    }
    if (best === null) {
      // 全滿 → 開新組（新組吃預設上限）
      groupCount++;
      stats.set(groupCount, { total: 0, fresh: 0, retrain: 0 });
      best = groupCount;
    }
    const st = stats.get(best)!;
    st.total++;
    if (retrain) st.retrain++;
    else st.fresh++;
    assignments.set(s.id, best);
  }
  return { assignments, groupCount };
}

/** 自動分組：延出者與工作人員排除；新生、舊生各自依 orderedAt/createdAt/id 穩定
 *  排序後 round-robin 散進各組（舊生從新生停下的游標接續）——上限內各組人數差 ≤1，
 *  且新舊比例鏡射整體名單（名單是 6:4 每組就約 6:4）。
 *  逐組上限（groupCaps）不同時：滿的組跳過，多出來的人自然流向上限大的組；
 *  總容量不夠才開新組（新組吃預設上限）。確定性：同輸入必同輸出。 */
export function assignGroups(
  signups: GroupableSignup[],
  cap: number,
  groupCaps: number[] = [],
): { assignments: Map<string, number>; groupCount: number } {
  const active = signups.filter((s) => !s.deferredToSessionId && !s.isStaff);
  // 組數：至少 6 組，容量累計到裝得下所有人
  let groupCount = MIN_GROUPS;
  let capacity = 0;
  for (let g = 1; g <= groupCount; g++) capacity += capForGroup(g, cap, groupCaps);
  while (capacity < active.length) {
    groupCount++;
    capacity += capForGroup(groupCount, cap, groupCaps);
  }

  const byTime = (a: GroupableSignup, b: GroupableSignup) => {
    const ta = a.orderedAt?.getTime() ?? a.createdAt.getTime();
    const tb = b.orderedAt?.getTime() ?? b.createdAt.getTime();
    return ta - tb || a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id);
  };
  const fresh = active.filter((s) => !isRetrainSignup(s)).sort(byTime);
  const retrain = active.filter((s) => isRetrainSignup(s)).sort(byTime);

  const assignments = new Map<string, number>();
  const counts = Array.from({ length: groupCount + 1 }, () => 0);
  let cursor = 0;
  for (const s of [...fresh, ...retrain]) {
    // 循環找下一個未滿的組（容量足夠，必有）
    let g = (cursor % groupCount) + 1;
    let hops = 0;
    while (counts[g] >= capForGroup(g, cap, groupCaps) && hops < groupCount) {
      cursor++;
      hops++;
      g = (cursor % groupCount) + 1;
    }
    counts[g]++;
    assignments.set(s.id, g);
    cursor++;
  }
  return { assignments, groupCount };
}
