/* R17 靜態契約：觀看權限不再受補填閘門阻擋，結帳與主動補填保留。 */
import { existsSync, readFileSync } from "node:fs";

const read = (path: string) => readFileSync(path, "utf8");
const layout = read("src/app/(member)/layout.tsx");
const auth = read("src/actions/auth.ts");
const login = auth.slice(auth.indexOf("export async function loginAction"), auth.indexOf("export type CompleteProfileState"));
const checkout = read("src/actions/checkout.ts");
const pages = [
  "src/app/(member)/dashboard/page.tsx",
  "src/app/(member)/my-courses/page.tsx",
  "src/app/(member)/learn/[courseSlug]/page.tsx",
];
const cases: [string, boolean][] = [
  ["會員 layout 不匯入也不呼叫 requireCompleteProfile", !layout.includes("requireCompleteProfile")],
  ["登入成功後不導向 complete-profile", !login.includes("/complete-profile") && /redirect\(dest\)/.test(login)],
  ["結帳仍要求補填姓名與手機", checkout.includes("/complete-profile?next=") && checkout.includes("memberProfile?.name") && checkout.includes("memberProfile.phone")],
  ["dashboard、my-courses、learn 三頁都有 ProfileReminder", pages.every((path) => read(path).includes("<ProfileReminder"))],
  ["complete-profile 頁仍存在", existsSync("src/app/(auth)/complete-profile/page.tsx")],
  ["會員資料頁主動補填 action 仍在", /export async function updatePhoneAction[\s\S]*?redirect\("\/complete-profile\?next=/.test(auth)],
];
let pass = 0;
for (const [name, ok] of cases) {
  console.log(`${ok ? "✓" : "✗"} ${name}`);
  if (ok) pass++;
}
console.log(`結果：${pass} 通過、${cases.length - pass} 失敗`);
process.exitCode = pass === cases.length ? 0 : 1;
