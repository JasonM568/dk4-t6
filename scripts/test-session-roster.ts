/* 場次名冊領域邏輯驗證（純函式、不碰 DB）：葷素判讀、統計、自動分組不變量。
 * 跑法：npx tsx scripts/test-session-roster.ts */
import {
  parseMealValue,
  mealLabel,
  computeRosterStats,
  assignGroups,
  assignRemaining,
  groupCountFor,
  normalizePersonName,
  isSamePerson,
  isRetrainSignup,
  type GroupableSignup,
} from "../src/lib/session-roster";

let pass = 0;
let fail = 0;
function check(name: string, ok: boolean, detail?: string) {
  if (ok) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fail++;
    console.error(`  ✗ ${name}${detail ? `\n    ${detail}` : ""}`);
  }
}

// 造名單：newCount 新生 + retrainCount 舊生，報名時間依序遞增
function makeSignups(newCount: number, retrainCount: number): GroupableSignup[] {
  const base = new Date("2026-08-01T00:00:00Z").getTime();
  const rows: GroupableSignup[] = [];
  for (let i = 0; i < newCount + retrainCount; i++) {
    rows.push({
      id: `s${String(i).padStart(3, "0")}`,
      product: i < newCount ? "量子課" : "量子課（複訓）",
      deferredToSessionId: null,
      orderedAt: new Date(base + i * 60_000),
      createdAt: new Date(base + i * 60_000),
    });
  }
  return rows;
}

function groupSizes(assignments: Map<string, number>, groupCount: number): number[] {
  const sizes = Array.from({ length: groupCount }, () => 0);
  for (const g of assignments.values()) sizes[g - 1]++;
  return sizes;
}

function main() {
  console.log("— 葷素判讀 —");
  check("素食 → VEG", parseMealValue("素食") === "VEG");
  check("全素 → VEG", parseMealValue("全素") === "VEG");
  check("葷 → MEAT", parseMealValue("葷") === "MEAT");
  check("葷食 → MEAT", parseMealValue("葷食") === "MEAT");
  check("空/null → null（未標）", parseMealValue("") === null && parseMealValue(null) === null);
  check("已知取捨：不吃素含「素」字判 VEG", parseMealValue("不吃素") === "VEG");
  check("label", mealLabel("VEG") === "素" && mealLabel("MEAT") === "葷" && mealLabel(null) === "葷（未標）");

  console.log("— 同一人判定（跨訂單重複防線）—");
  check("去空白／括號註記／大小寫", normalizePersonName("Polly  cheng（鄭寶莉）") === "pollycheng");
  check(
    "同名、兩邊都沒手機 → 同一人（團報名單常態）",
    isSamePerson({ name: "歐洸熏" }, { name: "歐洸熏", phone: null }),
  );
  check(
    "同名、一邊有手機 → 同一人",
    isSamePerson({ name: "歐洸熏", phone: "0975085939" }, { name: "歐洸熏", phone: null }),
  );
  check(
    "同名、同手機 → 同一人",
    isSamePerson({ name: "歐 洸熏", phone: "0975085939" }, { name: "歐洸熏", phone: "0975085939" }),
  );
  check(
    "同名、手機不同 → 不同人（照常入列）",
    !isSamePerson({ name: "陳建中", phone: "0911111111" }, { name: "陳建中", phone: "0922222222" }),
  );
  check(
    "不同名、同手機 → 不算同一人（夫妻共用號碼）",
    !isSamePerson({ name: "王小明", phone: "0911111111" }, { name: "王小美", phone: "0911111111" }),
  );
  check("空姓名不亂配對", !isSamePerson({ name: "" }, { name: "" }));
  check(
    "括號註記後仍認得（管理員補中文名）",
    isSamePerson({ name: "Polly cheng（鄭寶莉）" }, { name: "Polly Cheng" }),
  );

  console.log("— 統計 —");
  {
    const stats = computeRosterStats([
      { product: "量子課", meal: "MEAT", deferredToSessionId: null, groupNo: 1 },
      { product: "量子課", meal: "VEG", deferredToSessionId: null, groupNo: null },
      { product: "複訓｜手動", meal: null, deferredToSessionId: null, groupNo: 2 },
      { product: "量子課", meal: "VEG", deferredToSessionId: "other", groupNo: null }, // 延出
    ]);
    check(
      "延出排除、未標算葷、未分組計數",
      stats.total === 3 && stats.fresh === 2 && stats.retrain === 1 &&
        stats.veg === 1 && stats.meat === 2 && stats.mealUnknown === 1 &&
        stats.deferredOut === 1 && stats.ungrouped === 1,
      JSON.stringify(stats),
    );
  }

  console.log("— 新舊生人工覆寫 —");
  {
    check("null → 沿用產品名判別（複訓）", isRetrainSignup({ product: "量子課（複訓）", isRetrain: null }));
    check("null → 沿用產品名判別（新生）", !isRetrainSignup({ product: "量子課" }));
    check("覆寫 true 蓋過產品名", isRetrainSignup({ product: "量子課", isRetrain: true }));
    check("覆寫 false 蓋過「複訓」產品名", !isRetrainSignup({ product: "量子課（複訓）", isRetrain: false }));
    const stats = computeRosterStats([
      { product: "量子課", isRetrain: true, meal: "MEAT", deferredToSessionId: null, groupNo: 1 },
      { product: "複訓｜手動", isRetrain: false, meal: "MEAT", deferredToSessionId: null, groupNo: 1 },
      { product: "量子課", meal: "MEAT", deferredToSessionId: null, groupNo: 1 },
    ]);
    check(
      "統計吃覆寫值",
      stats.total === 3 && stats.retrain === 1 && stats.fresh === 2,
      JSON.stringify(stats),
    );
    // 分組的新舊生均衡也要吃覆寫：10 人全是「產品名新生」但半數被改成舊生
    const rows = makeSignups(10, 0).map((r, i) => ({ ...r, isRetrain: i % 2 === 1 }));
    const { assignments } = assignGroups(rows, 8);
    const perGroup = new Map<number, number>();
    for (const r of rows) {
      if (!isRetrainSignup(r)) continue;
      const g = assignments.get(r.id)!;
      perGroup.set(g, (perGroup.get(g) ?? 0) + 1);
    }
    check(
      "分組依覆寫後的新舊生散開（每組舊生 ≤1）",
      [...perGroup.values()].every((n) => n <= 1),
      JSON.stringify([...perGroup]),
    );
  }

  console.log("— 組數規則 —");
  check("8 人 cap8 → 仍 6 組（下限）", groupCountFor(8, 8) === 6);
  check("48 人 cap8 → 6 組", groupCountFor(48, 8) === 6);
  check("49 人 cap8 → 7 組", groupCountFor(49, 8) === 7);
  check("100 人 cap8 → 13 組", groupCountFor(100, 8) === 13);

  console.log("— 分組不變量 —");
  {
    // 60 人 6:4（36 新 24 舊）cap 8 → 8 組
    const signups = makeSignups(36, 24);
    const { assignments, groupCount } = assignGroups(signups, 8);
    check("全員都有組", assignments.size === 60);
    check("組數 = ⌈60/8⌉ = 8", groupCount === 8, String(groupCount));
    const sizes = groupSizes(assignments, groupCount);
    check("組間人數差 ≤1", Math.max(...sizes) - Math.min(...sizes) <= 1, sizes.join(","));
    // 各組新舊比：每組新生數差 ≤1、舊生數差 ≤1（鏡射整體 6:4）
    const freshPer = Array.from({ length: groupCount }, () => 0);
    const retrainPer = Array.from({ length: groupCount }, () => 0);
    for (const s of signups) {
      const g = assignments.get(s.id)! - 1;
      if (s.product?.includes("複訓")) retrainPer[g]++;
      else freshPer[g]++;
    }
    check("各組新生數差 ≤1", Math.max(...freshPer) - Math.min(...freshPer) <= 1, freshPer.join(","));
    check("各組舊生數差 ≤1", Math.max(...retrainPer) - Math.min(...retrainPer) <= 1, retrainPer.join(","));
    check("cap 遵守", Math.max(...sizes) <= 8, sizes.join(","));

    // 確定性：同輸入必同輸出
    const again = assignGroups(signups, 8);
    check(
      "確定性（同輸入同結果）",
      [...assignments.entries()].every(([id, g]) => again.assignments.get(id) === g),
    );
  }
  {
    // 延出者不分組
    const signups = makeSignups(10, 5);
    signups[0] = { ...signups[0], deferredToSessionId: "other" };
    const { assignments } = assignGroups(signups, 8);
    check("延出者不佔組", !assignments.has(signups[0].id) && assignments.size === 14);
  }
  {
    // 小場：8 人也要 6 組
    const { assignments, groupCount } = assignGroups(makeSignups(5, 3), 8);
    const sizes = groupSizes(assignments, groupCount);
    check("小場 8 人分 6 組、每組 1-2 人", groupCount === 6 && Math.max(...sizes) <= 2, sizes.join(","));
  }

  console.log("— 補分組（每日更新名單後的新報名）—");
  {
    // 42 人已分好 6 組，再來 6 位新報名（4 新 2 舊）→ 只補這 6 位，既有組別不動
    const base = makeSignups(25, 17);
    const { assignments: first } = assignGroups(base, 8);
    const grouped = base.map((s) => ({ ...s, groupNo: first.get(s.id)! }));
    const newcomers = makeSignups(4, 2).map((s, i) => ({
      ...s,
      id: `new${i}`,
      orderedAt: new Date("2026-08-10T00:00:00Z"),
      groupNo: null as number | null,
    }));
    const all = [...grouped, ...newcomers];
    const { assignments, groupCount } = assignRemaining(all, 8);
    check("只分未分組的人", assignments.size === 6 && newcomers.every((s) => assignments.has(s.id)));
    check("不動既有組別（回傳不含已分組者）", grouped.every((s) => !assignments.has(s.id)));
    const sizes = Array.from({ length: groupCount }, (_, i) => i + 1).map(
      (g) =>
        grouped.filter((s) => s.groupNo === g).length +
        [...assignments.values()].filter((v) => v === g).length,
    );
    check("補完各組人數仍均衡（差 ≤1）且不超上限", Math.max(...sizes) - Math.min(...sizes) <= 1 && Math.max(...sizes) <= 8, sizes.join(","));
  }
  {
    // 全組都滿 → 開新組
    const base = makeSignups(30, 18); // 48 人 cap8 → 6 組全滿
    const { assignments: first } = assignGroups(base, 8);
    const grouped = base.map((s) => ({ ...s, groupNo: first.get(s.id)! }));
    const extra = { ...makeSignups(1, 0)[0], id: "overflow", groupNo: null as number | null };
    const { assignments, groupCount } = assignRemaining([...grouped, extra], 8);
    check("全滿時開第 7 組", assignments.get("overflow") === 7 && groupCount === 7, `${assignments.get("overflow")}/${groupCount}`);
  }
  {
    // 還沒分過組時，補分組 = 全量分組
    const fresh = makeSignups(10, 5).map((s) => ({ ...s, groupNo: null as number | null }));
    const { assignments, groupCount } = assignRemaining(fresh, 8);
    check("無既有組 → 等同全量分組", assignments.size === 15 && groupCount === 6);
  }

  console.log("— 逐組上限（場地桌子大小不一）—");
  {
    // 50 人、預設 8、第 1 組上限 10：容量 10+8*5=50 剛好 → 6 組，第 1 組收滿 10
    const { assignments, groupCount } = assignGroups(makeSignups(30, 20), 8, [10]);
    const sizes = groupSizes(assignments, groupCount);
    check("第 1 組上限 10 收滿、其餘 8", groupCount === 6 && sizes[0] === 10 && sizes.slice(1).every((n) => n === 8), sizes.join(","));
  }
  {
    // 逐組上限縮小 → 容量不足自動開新組：24 人、全組上限 3 → 8 組
    const { assignments, groupCount } = assignGroups(makeSignups(16, 8), 8, [3, 3, 3, 3, 3, 3, 3, 3]);
    const sizes = groupSizes(assignments, groupCount);
    check("上限縮小自動加組數", groupCount === 8 && Math.max(...sizes) <= 3, `${groupCount}組 ${sizes.join(",")}`);
  }
  {
    // 補分組吃逐組上限：第 1 組已滿（上限 4）→ 新人不進第 1 組
    const base = makeSignups(24, 0);
    const { assignments: first } = assignGroups(base, 4);
    const grouped = base.map((s) => ({ ...s, groupNo: first.get(s.id)! }));
    const extra = { ...makeSignups(1, 0)[0], id: "late", groupNo: null as number | null };
    const { assignments } = assignRemaining([...grouped, extra], 8, [4, 4, 4, 4, 4, 8]);
    // 前 5 組上限 4 全滿，只有第 6 組（上限 8）有位
    check("補分組避開已滿的逐組上限", assignments.get("late") === 6, String(assignments.get("late")));
  }

  console.log("— 工作人員 —");
  {
    const staffRow = { ...makeSignups(1, 0)[0], id: "staff1", isStaff: true };
    const { assignments } = assignGroups([...makeSignups(10, 5), staffRow], 8);
    check("工作人員不列入分組", !assignments.has("staff1") && assignments.size === 15);
    const stats = computeRosterStats([
      { product: "量子課", meal: "MEAT", deferredToSessionId: null, groupNo: 1 },
      { product: "工作人員", meal: "VEG", deferredToSessionId: null, groupNo: null, isStaff: true },
      { product: "工作人員", meal: null, deferredToSessionId: null, groupNo: null, isStaff: true },
    ]);
    check(
      "工作人員：不算學員/新舊生/未分組，但算用餐",
      stats.total === 1 && stats.staff === 2 && stats.ungrouped === 0 &&
        stats.veg === 1 && stats.meat === 2 && stats.mealUnknown === 1,
      JSON.stringify(stats),
    );
  }

  console.log(`\n結果：${pass} 通過、${fail} 失敗`);
  if (fail > 0) process.exit(1);
}

main();
