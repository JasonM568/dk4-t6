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
  registerSilence,
  SILENT_DAYS_WARN,
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
    // 走監控板同一支函式，不在測試裡重算一遍——複製公式等於沒驗到
    const { daysSilent, alarm } = registerSilence(lastSuccess?.createdAt ?? null);
    check("剛寫入的那筆算出 0 天", daysSilent === 0, `實得 ${daysSilent}`);
    check("剛註冊成功不報警", alarm === false);
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

  console.log("\n掛零幾天就轉紅字告警（板子存在的理由，正式站不能靠真的壞掉來驗）");
  {
    const now = new Date("2026-09-12T12:00:00+08:00");
    const daysAgo = (n: number) => new Date(now.getTime() - n * 86_400_000);

    const none = registerSilence(null, now);
    check("完全沒有紀錄時不報警（表剛上線不該叫狼來了）", none.alarm === false);
    check("完全沒有紀錄時天數為 null", none.daysSilent === null);

    const today = registerSilence(daysAgo(0), now);
    check("今天才有人註冊成功：0 天、不報警", today.daysSilent === 0 && !today.alarm);

    const two = registerSilence(daysAgo(2), now);
    check(
      `掛零 2 天（未達 ${SILENT_DAYS_WARN} 天門檻）不報警`,
      two.daysSilent === 2 && !two.alarm,
    );

    const three = registerSilence(daysAgo(3), now);
    check(
      `掛零 ${SILENT_DAYS_WARN} 天就報警 ← 這一格當初是缺的`,
      three.daysSilent === 3 && three.alarm === true,
    );

    const fourteen = registerSilence(daysAgo(14), now);
    check(
      "掛零 14 天報警（2026-08-29 那次事故的長度）",
      fourteen.daysSilent === 14 && fourteen.alarm === true,
    );

    const future = registerSilence(new Date(now.getTime() + 3_600_000), now);
    check("時鐘誤差導致的未來時間不會算成負天數", future.daysSilent === 0 && !future.alarm);
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
