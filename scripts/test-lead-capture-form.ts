/* 問卷必填題的瀏覽器端提示契約（純離線，讀原始碼）。
 * 複選不可用 HTML required，因為每顆 checkbox 都會變成必勾。
 * 跑法：npx tsx scripts/test-lead-capture-form.ts */
import { readFileSync } from "node:fs";

const src = readFileSync(new URL("../src/app/webinar/[slug]/request-form.tsx", import.meta.url), "utf8");
let pass = 0;
let fail = 0;
function check(name: string, ok: boolean) {
  if (ok) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fail++;
    console.error(`  ✗ ${name}`);
  }
}

const textarea = src.match(/<textarea\b[\s\S]*?\/>/)?.[0] ?? "";
const inputs = [...src.matchAll(/<input\b[\s\S]*?\/>/g)].map(([tag]) => tag);
const radio = inputs.find((tag) => /\btype="radio"/.test(tag)) ?? "";
const checkbox = inputs.find((tag) => /\btype="checkbox"/.test(tag)) ?? "";

check("找得到簡答 textarea", textarea !== "");
check("簡答依題目必填屬性提示", /\brequired=\{q\.required\}/.test(textarea));
check("找得到單選 radio", radio !== "");
check("單選每顆 radio 依題目必填屬性提示", /\brequired=\{q\.required\}/.test(radio));
check("找得到複選 checkbox", checkbox !== "");
check("複選 checkbox 不加 required", !/\brequired\b/.test(checkbox));

console.log(`\n${pass} 過 / ${fail} 失敗`);
if (fail > 0) process.exitCode = 1;
