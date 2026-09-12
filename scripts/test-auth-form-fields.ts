/* 註冊／補填表單的「欄位名稱契約」驗證（純離線，不碰資料庫）。
 *
 * 擋的是 2026-08-29～09-12 那個沒有人發現的整站當機：
 * parseProfileFields 寫死讀 formData.get("name")，但註冊頁的欄位叫 displayName。
 * pnpm tsc 過、next build 過、單元測試沒有涵蓋——直到有學員回報
 * 「我明明填了姓名，它說我沒填」才被發現，正式站已經 14 天零註冊。
 *
 * 這支測試直接讀原始碼比對「表單送出的欄位」與「action 要求的欄位」，
 * 因為型別系統跨不過 FormData 這層字串。
 * 跑法：npx tsx scripts/test-auth-form-fields.ts */
import { readFileSync } from "node:fs";
import {
  PROFILE_NAME_FIELD,
  REGISTER_NAME_FIELD,
} from "../src/lib/auth/form-fields";

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

const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

/** 抓出表單裡所有 <input name=...> 的欄位名：字串字面值與 {常數} 兩種寫法都收 */
function formFields(src: string, consts: Record<string, string>): Set<string> {
  const out = new Set<string>();
  for (const m of src.matchAll(/name="([^"]+)"/g)) out.add(m[1]);
  for (const m of src.matchAll(/name=\{([A-Z_][A-Z0-9_]*)\}/g)) {
    const v = consts[m[1]];
    if (v) out.add(v);
  }
  return out;
}

const CONSTS = {
  REGISTER_NAME_FIELD,
  PROFILE_NAME_FIELD,
};

const registerSrc = read("src/app/(auth)/register/page.tsx");
const profileSrc = read("src/app/(auth)/complete-profile/form.tsx");
const authSrc = read("src/actions/auth.ts");

const registerFields = formFields(registerSrc, CONSTS);
const profileFields = formFields(profileSrc, CONSTS);

console.log("\n註冊頁送得出 action 必要的每一個欄位");
{
  // registerAction 必要欄位：姓名（displayName）、email、password、手機、個資同意
  for (const f of [REGISTER_NAME_FIELD, "email", "password", "phone", "privacyConsent"])
    check(`註冊表單有 ${f}`, registerFields.has(f), `實有：${[...registerFields].join(", ")}`);
}

console.log("\n補填頁送得出 action 必要的每一個欄位");
{
  for (const f of [PROFILE_NAME_FIELD, "phone", "privacyConsent"])
    check(`補填表單有 ${f}`, profileFields.has(f), `實有：${[...profileFields].join(", ")}`);
}

console.log("\n兩個姓名欄位不得互相混用（正是當初壞掉的原因）");
{
  // 兩個常數目前本來就不同值；比對用字串副本，免得 TS 把它判成恆假的比較
  const registerName: string = REGISTER_NAME_FIELD;
  const profileName: string = PROFILE_NAME_FIELD;
  check(
    "註冊頁沒有跟補填頁共用同一個姓名欄位名",
    registerName === profileName || !registerFields.has(profileName),
  );
  check(
    "parseProfileFields 不再寫死 formData.get(\"name\")",
    !/formData\.get\("name"\)/.test(authSrc),
    "改回寫死字串就等於把 2026-08-29 的當機再做一次",
  );
  check(
    "registerAction 明確指定用 REGISTER_NAME_FIELD 解析姓名",
    /parseProfileFields\(formData,\s*REGISTER_NAME_FIELD\)/.test(authSrc),
  );
}

console.log("\n註冊時要把姓名寫進 MemberProfile（否則結帳會把人彈去補填頁重打）");
{
  const registerBody = authSrc.slice(authSrc.indexOf("export async function registerAction"));
  const upsert = registerBody.slice(
    registerBody.indexOf("memberProfile.upsert"),
    registerBody.indexOf("memberProfile.upsert") + 700,
  );
  const nameWrites = [...upsert.matchAll(/name:\s*displayName/g)].length;
  check("upsert 的 create 與 update 都寫入 name", nameWrites === 2, `實得 ${nameWrites} 處`);
}

console.log(`\n${pass} 過 / ${fail} 失敗`);
if (fail > 0) process.exitCode = 1;
