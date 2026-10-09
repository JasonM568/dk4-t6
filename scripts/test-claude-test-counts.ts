/* 核對 CLAUDE.md 常用指令註記的項數與測試實際輸出。
 * DB 測試只准 localhost，並清空外部寄信／簡訊／Supabase secret key。
 * 跑法：npx tsx scripts/test-claude-test-counts.ts */
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const doc = read("CLAUDE.md");
const dbUrl = read(".env").split("\n").find((line) => line.startsWith("DATABASE_URL="))
  ?.slice("DATABASE_URL=".length).trim().replace(/^['"]|['"]$/g, "") ?? "";
if (!/@(localhost|127\.0\.0\.1)[:/]/.test(dbUrl)) {
  console.error("✗ DATABASE_URL 不是 localhost，拒絕執行測試清單");
  process.exit(1);
}

const env = {
  ...process.env,
  DATABASE_URL: dbUrl,
  RESEND_API_KEY: "",
  MAACGO_API_KEY: "",
  SUPABASE_SECRET_KEY: "",
};
let checked = 0;
for (const line of doc.split("\n")) {
  if (!line.startsWith("npx tsx ")) continue;
  const [command, comment = ""] = line.split(/\s+#\s+/, 2);
  const expected = comment.match(/(\d+)\s*項/)?.[1];
  if (!expected) continue;
  const args = command.trim().split(/\s+/).slice(1);
  const result = spawnSync("npx", args, { env, encoding: "utf8", timeout: 120_000 });
  const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
  const actual = output.match(/(?:全部通過|全數通過)（(\d+)\s*項）/)?.[1]
    ?? [...output.matchAll(/(\d+)\s*(?:過|通過)\s*[/、]\s*0\s*失敗/g)].at(-1)?.[1]
    ?? [...output.matchAll(/通過\s*(\d+)\s*、\s*失敗\s*0/g)].at(-1)?.[1];
  if (result.status !== 0 || actual !== expected) {
    console.error(`✗ ${args.at(-1)}：文件 ${expected} 項，實際 ${actual ?? "無結果"} 項，exit=${result.status}`);
    process.exit(1);
  }
  checked++;
  console.log(`  ✓ ${args.at(-1)}：${actual} 項`);
}
console.log(`\n${checked} 支測試項數相符`);
