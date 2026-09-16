/* 場次分組「固定組數」的驗證（純離線，不碰資料庫）。
 *
 * 起因：組數原本是推導出來的 max(6, 容量裝得下所有人的最小組數)，人一多就自動
 * 開新組、沒有天花板。實體場地只有 8 張桌子時系統分出 9 組，名單就跟現場對不起來。
 *
 * 守的兩條線：
 *   1. 固定組數時組數鎖死，容量不足由呼叫端擋下——不默默超收、也不默默丟人
 *   2. 留空（fixedCount=null）時行為與原本完全一致
 *
 * 跑法：npx tsx scripts/test-session-groups.ts */
import {
  assignGroups,
  assignRemaining,
  capForGroup,
  groupCapacity,
  groupCountFor,
  MIN_GROUPS,
  normalizeFixedCount,
  signupsBeyondGroup,
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

/** 造 n 個報名者；每隔 step 個放一位舊生，讓新舊比例可驗 */
function makeSignups(n: number, opts: { retrainEvery?: number; staff?: number } = {}) {
  const { retrainEvery = 0, staff = 0 } = opts;
  const rows = [];
  for (let i = 0; i < n; i++) {
    rows.push({
      id: `s${String(i).padStart(3, "0")}`,
      product: retrainEvery && i % retrainEvery === 0 ? "AI初階（複訓）" : "AI初階",
      deferredToSessionId: null as string | null,
      orderedAt: new Date(2026, 8, 1, 0, i),
      createdAt: new Date(2026, 8, 1, 0, i),
      isStaff: false,
      groupNo: null as number | null,
    });
  }
  for (let i = 0; i < staff; i++) {
    rows.push({
      id: `staff${i}`,
      product: "工作人員",
      deferredToSessionId: null as string | null,
      orderedAt: new Date(2026, 8, 1, 1, i),
      createdAt: new Date(2026, 8, 1, 1, i),
      isStaff: true,
      groupNo: null as number | null,
    });
  }
  return rows;
}

const sizes = (a: Map<string, number>, groupCount: number) => {
  const c = Array.from({ length: groupCount + 1 }, () => 0);
  for (const g of a.values()) c[g]++;
  return c.slice(1);
};

console.log("\n容量計算吃得到逐組上限（不是 N × 預設上限）");
{
  check("8 組 × 上限 8 = 64 席", groupCapacity(8, 8) === 64);
  // 第 1 組是大桌 12 人：64 - 8 + 12 = 68
  check(
    "第 1 組覆寫成 12 → 68 席",
    groupCapacity(8, 8, [12]) === 68,
    `實得 ${groupCapacity(8, 8, [12])}`,
  );
  check("覆寫 0 視為用預設", capForGroup(1, 8, [0]) === 8);
}

console.log("\nAC#1 固定 8 組、70 人、上限 8 → 容量不足，呼叫端擋得下來");
{
  const active = 70;
  const capacity = groupCapacity(8, 8);
  check("容量 64 < 70，判定塞不下", capacity < active);
  check("尚差 6 席（錯誤訊息要報的數字）", active - capacity === 6);
}

console.log("\nAC#2 固定 8 組、60 人、上限 8 → 分成 8 組且均勻");
{
  const rows = makeSignups(60, { retrainEvery: 3 });
  const { assignments, groupCount } = assignGroups(rows, 8, [], 8);
  check("組數 = 8（不是公式的 8 也不是 6）", groupCount === 8);
  check("60 人全部分到組", assignments.size === 60);
  const c = sizes(assignments, groupCount);
  check(`各組人數差 ≤1（${c.join("/")}）`, Math.max(...c) - Math.min(...c) <= 1);
  check("沒有人被分到第 9 組", Math.max(...assignments.values()) <= 8);
}

console.log("\nAC#3 固定 4 組、20 人 → 允許低於下限 6（固定值優先）");
{
  const rows = makeSignups(20);
  const { assignments, groupCount } = assignGroups(rows, 8, [], 4);
  check(`組數 = 4，低於 MIN_GROUPS=${MIN_GROUPS}`, groupCount === 4);
  check("20 人全部分到組", assignments.size === 20);
  check("組號不超過 4", Math.max(...assignments.values()) <= 4);
}

console.log("\nAC#4 留空＝行為完全不變（這次最該守的回歸線）");
{
  const rows = makeSignups(70, { retrainEvery: 3 });
  const before = assignGroups(rows, 8, []); // 舊呼叫方式（不傳第四個參數）
  const after = assignGroups(rows, 8, [], null); // 明確傳 null
  check("不傳與傳 null 的組數一致", before.groupCount === after.groupCount);
  check(
    "不傳與傳 null 的每一筆分派都一致",
    [...before.assignments].every(([id, g]) => after.assignments.get(id) === g),
  );
  check(
    "70 人、上限 8 仍自動長到 9 組（原本的行為）",
    before.groupCount === 9,
    `實得 ${before.groupCount}`,
  );
  const few = assignGroups(makeSignups(10), 8, []);
  check(`10 人仍是下限 ${MIN_GROUPS} 組`, few.groupCount === MIN_GROUPS);
}

console.log("\nAC#5 逐組上限覆寫：容量算得對，分派也吃得到");
{
  // 固定 6 組，第 1 組大桌 20 人，其餘 8 人 → 容量 20 + 40 = 60
  const caps = [20];
  check("容量 = 60", groupCapacity(6, 8, caps) === 60);
  const rows = makeSignups(58);
  const { assignments, groupCount } = assignGroups(rows, 8, caps, 6);
  check("組數 = 6", groupCount === 6);
  check("58 人全部分到組", assignments.size === 58);
  const c = sizes(assignments, groupCount);
  check(`第 1 組吃得下超過預設上限（${c[0]} > 8）`, c[0] > 8);
  check(
    "其餘各組不超過預設上限 8",
    c.slice(1).every((n) => n <= 8),
    `實得 ${c.join("/")}`,
  );
}

console.log("\nAC#6 補分組：同樣鎖 N 組，已分好的不動");
{
  const rows = makeSignups(40);
  // 先讓 30 人分進 6 組
  const first = assignGroups(rows.slice(0, 30), 8, [], 6);
  for (const r of rows) r.groupNo = first.assignments.get(r.id) ?? null;
  const { assignments, groupCount } = assignRemaining(rows, 8, [], 6);
  check("補分組後組數仍是 6", groupCount === 6);
  check("只回報這次補進去的 10 人", assignments.size === 10);
  check("補進去的人組號不超過 6", [...assignments.values()].every((g) => g <= 6));
  check(
    "已分好的 30 人組別完全沒動",
    rows.slice(0, 30).every((r) => first.assignments.get(r.id) === r.groupNo),
  );
}

console.log("\nAC#7 工作人員與延期者不佔組、不計入容量");
{
  const rows = makeSignups(30, { staff: 5 });
  rows[0].deferredToSessionId = "other-session";
  const { assignments, groupCount } = assignGroups(rows, 8, [], 6);
  check("組數 = 6", groupCount === 6);
  check("只有 29 位學員入組（30 − 1 延期）", assignments.size === 29);
  check(
    "工作人員沒有被分組",
    rows.filter((r) => r.isStaff).every((r) => !assignments.has(r.id)),
  );
  check("延期者沒有被分組", !assignments.has(rows[0].id));
}

console.log("\n改小固定組數：既有第 N+1 組的人要擋下來（請先全量重分）");
{
  const rows = makeSignups(60);
  const nine = assignGroups(rows, 8, [], 9);
  for (const r of rows) r.groupNo = nine.assignments.get(r.id) ?? null;
  const beyond = signupsBeyondGroup(rows, 8);
  check("偵測到有人在第 8 組之後", beyond.count > 0);
  check("回報最大組號 = 9（錯誤訊息要報的數字）", beyond.maxGroupNo === 9);
  const none = signupsBeyondGroup(rows, 9);
  check("固定 9 組時沒有人超出", none.count === 0);
  // 工作人員與延期者即使有殘留組號也不該被算進去
  const staffRow = [
    { groupNo: 12, deferredToSessionId: null, isStaff: true },
    { groupNo: 12, deferredToSessionId: "x", isStaff: false },
  ];
  check("工作人員／延期者的殘留組號不算超出", signupsBeyondGroup(staffRow, 8).count === 0);
}

console.log("\ngroupCountFor：固定值優先，且吃得到逐組上限（修掉舊的顯示不一致）");
{
  check("固定 8 → 8", groupCountFor(70, 8, [], 8) === 8);
  check("固定 4 → 4（低於下限也允許）", groupCountFor(20, 8, [], 4) === 4);
  check("留空 70 人上限 8 → 9", groupCountFor(70, 8, []) === 9);
  check("留空 10 人 → 下限 6", groupCountFor(10, 8, []) === MIN_GROUPS);
  // 第 1 組大桌 20 人：6 組容量已達 60，不該再開第 7 組
  check(
    "逐組上限讓容量變大時不多開組",
    groupCountFor(60, 8, [20]) === 6,
    `實得 ${groupCountFor(60, 8, [20])}`,
  );
}

console.log("\nnormalizeFixedCount：不合法的值一律當自動，不讓髒資料鎖死組數");
{
  check("null → null", normalizeFixedCount(null) === null);
  check("undefined → null", normalizeFixedCount(undefined) === null);
  check("0 → null", normalizeFixedCount(0) === null);
  check("-3 → null", normalizeFixedCount(-3) === null);
  check("100 → null（上界與每組上限一致）", normalizeFixedCount(100) === null);
  check("NaN → null", normalizeFixedCount(Number.NaN) === null);
  check("8 → 8", normalizeFixedCount(8) === 8);
  check("8.7 → 8（無條件捨去）", normalizeFixedCount(8.7) === 8);
}

console.log("\n確定性：同輸入必同輸出（名單每天重匯，組別不該跳來跳去）");
{
  const a = assignGroups(makeSignups(50, { retrainEvery: 3 }), 8, [], 7);
  const b = assignGroups(makeSignups(50, { retrainEvery: 3 }), 8, [], 7);
  check(
    "兩次分組結果完全相同",
    [...a.assignments].every(([id, g]) => b.assignments.get(id) === g),
  );
}

console.log(`\n${pass} 過 / ${fail} 失敗`);
if (fail > 0) process.exitCode = 1;
