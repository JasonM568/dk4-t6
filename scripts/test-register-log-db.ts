/* 註冊嘗試紀錄的驗證（會寫入資料庫，**只能對本機 localhost 跑**）。
 *
 * 這是 2026-08-29 那次事故的補救措施：註冊壞了 14 天卻零告警。
 * 驗兩件事——
 *   1. 個資最小化真的成立（成功的紀錄不得存 email／姓名／手機；任何情況不存密碼）
 *   2. 監控板算得出「連續 N 天沒有人註冊成功」與「系統面 vs 使用者狀況」的分類
 *
 * 跑法：npx tsx --conditions=react-server scripts/test-register-log-db.ts */
import { prisma } from "../src/lib/db";
import {
  isUserSideReason,
  logRegisterAttempt,
  purgeOldRegisterAttempts,
  REGISTER_ATTEMPT_RETENTION_DAYS,
  REGISTER_REASON,
} from "../src/lib/auth/register-log";

const url = process.env.DATABASE_URL ?? "";
if (!/@(localhost|127\.0\.0\.1)[:/]/.test(url)) {
  console.error("✗ DATABASE_URL 不是本機資料庫，拒絕執行（此測試會寫入）");
  process.exit(1);
}

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

const TAG = "register-log-test";
const EMAIL = `${TAG}@example.com`;

async function cleanup() {
  await prisma.registerAttempt.deleteMany({
    where: { OR: [{ email: EMAIL }, { detail: { contains: TAG } }] },
  });
}

async function main() {
  await cleanup();

  console.log("\n個資最小化");
  {
    await logRegisterAttempt({
      reason: REGISTER_REASON.SUCCESS,
      email: EMAIL,
      name: "應該被丟掉",
      phone: "0900000000",
      detail: TAG,
    });
    const row = await prisma.registerAttempt.findFirst({
      where: { detail: { contains: TAG }, reason: REGISTER_REASON.SUCCESS },
    });
    check("成功的紀錄有寫進去", !!row);
    check("成功的紀錄不存 email", row?.email === null, `實得 ${row?.email}`);
    check("成功的紀錄不存姓名", row?.name === null, `實得 ${row?.name}`);
    check("成功的紀錄不存手機", row?.phone === null, `實得 ${row?.phone}`);
  }
  {
    await logRegisterAttempt({
      reason: REGISTER_REASON.NAME,
      email: EMAIL.toUpperCase(),
      name: "  黃郁忠  ",
      phone: "0901309490",
      detail: `${TAG} 姓名沒填`,
    });
    const row = await prisma.registerAttempt.findFirst({
      where: { reason: REGISTER_REASON.NAME, detail: { contains: TAG } },
    });
    check("失敗的紀錄有存 email（要拿來找人）", row?.email === EMAIL, `實得 ${row?.email}`);
    check("email 正規化成小寫", row?.email === row?.email?.toLowerCase());
    check("姓名前後空白去掉", row?.name === "黃郁忠", `實得 ${JSON.stringify(row?.name)}`);
    check("手機有存", row?.phone === "0901309490");
  }
  {
    // 整張表都不該出現密碼欄位——用 schema 而不是靠自律
    const cols = await prisma.$queryRawUnsafe<{ column_name: string }[]>(
      `select column_name from information_schema.columns
       where table_schema='course' and table_name='RegisterAttempt'`,
    );
    const names = cols.map((c) => c.column_name.toLowerCase());
    check(
      "資料表沒有任何密碼欄位",
      !names.some((n) => n.includes("password") || n.includes("pwd")),
      `欄位：${names.join(", ")}`,
    );
  }

  console.log("\n失敗分類：系統面 vs 使用者自身狀況");
  {
    check("姓名沒填算系統面", !isUserSideReason(REGISTER_REASON.NAME));
    check("手機格式算系統面", !isUserSideReason(REGISTER_REASON.PHONE));
    check("Supabase 回錯算系統面", !isUserSideReason(REGISTER_REASON.AUTH));
    check("Email 已註冊過算使用者狀況", isUserSideReason(REGISTER_REASON.EMAIL_TAKEN));
    check("邀請碼無效算使用者狀況", isUserSideReason(REGISTER_REASON.INVITE));
  }

  console.log("\n「連續幾天沒人註冊成功」算得出來");
  {
    const lastSuccess = await prisma.registerAttempt.findFirst({
      where: { reason: REGISTER_REASON.SUCCESS },
      orderBy: { createdAt: "desc" },
      select: { createdAt: true },
    });
    check("查得到最後一次成功", !!lastSuccess);
    const days = lastSuccess
      ? Math.floor((Date.now() - lastSuccess.createdAt.getTime()) / 86_400_000)
      : -1;
    check("剛寫入的那筆算出 0 天", days === 0, `實得 ${days}`);
  }

  console.log(`\n保存期限清理（${REGISTER_ATTEMPT_RETENTION_DAYS} 天）`);
  {
    const old = await prisma.registerAttempt.create({
      data: {
        reason: REGISTER_REASON.PHONE,
        email: EMAIL,
        detail: `${TAG} 過期的`,
        createdAt: new Date(
          Date.now() - (REGISTER_ATTEMPT_RETENTION_DAYS + 1) * 86_400_000,
        ),
      },
    });
    const fresh = await prisma.registerAttempt.findFirst({
      where: { reason: REGISTER_REASON.NAME, detail: { contains: TAG } },
    });
    await purgeOldRegisterAttempts();
    const oldStill = await prisma.registerAttempt.findUnique({ where: { id: old.id } });
    const freshStill = await prisma.registerAttempt.findUnique({
      where: { id: fresh!.id },
    });
    check("超過保存期限的被刪掉", oldStill === null);
    check("期限內的沒被誤刪", freshStill !== null);
  }

  await cleanup();
  console.log(`\n${pass} 過 / ${fail} 失敗`);
  if (fail > 0) process.exitCode = 1;
}

main()
  .catch(async (e) => {
    console.error(e);
    await cleanup();
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
