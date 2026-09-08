/* 蜜罐擋下的索取「不再無聲消失」（會寫入資料庫，**只能對本機 localhost 跑**）。
 *
 * 這支測試守的是一個具體的事故：2026-09-03 與 2026-09-08 各有一位真人在講座登記頁
 * 按了送出、看到「已寄出」，但信沒寄、名單沒有他，而蜜罐那條路只寫了一行
 * console.error——Vercel log 保存期短到事後查不回來，兩起都只能用刪去法推定原因。
 *
 * 所以這裡驗的不是「蜜罐擋不擋得住機器人」，而是**擋下之後有沒有留下可追查的痕跡**，
 * 以及後台補寄能不能把人救回來。
 * 跑法：npx tsx --conditions=react-server scripts/test-webinar-honeypot-db.ts
 * 測完會刪掉自己建的講座與所有衍生紀錄。 */
import { prisma } from "../src/lib/db";
import {
  dismissBlockedWebinarAttempt,
  HONEYPOT_SUCCESS_MESSAGE,
  isHoneypotTripped,
  recordBlockedWebinarAttempt,
  resendBlockedWebinarAttempt,
} from "../src/lib/webinar-honeypot";

const url = process.env.DATABASE_URL ?? "";
if (!/@(localhost|127\.0\.0\.1)[:/]/.test(url)) {
  console.error("✗ DATABASE_URL 不是本機資料庫，拒絕執行（此測試會寫入）");
  process.exit(1);
}

// **第二道鎖：把寄信能力拔掉。**
// localhost guard 只擋得住資料庫，擋不住外部 API——本機 .env 帶的是正式 Resend 金鑰，
// 補寄那段會真的打出去。第一版就這樣打到了 Resend，只因為收件人是 example.com
// 被對方擋下才沒寄出，那是運氣不是設計（2026-08 曾因同類問題誤建正式帳號）。
// 清空金鑰後 sendBroadcast 直接走「尚未設定」的失敗分支，保證零封信、零次網路呼叫。
process.env.RESEND_API_KEY = "";

let pass = 0;
let fail = 0;
function check(name: string, ok: boolean, detail?: string) {
  if (ok) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fail++;
    console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

const SLUG = `hp-test-${Date.now()}`;
const VICTIM = `honeypot.victim.${Date.now()}@example.com`;

async function main() {
  const webinar = await prisma.webinar.create({
    data: {
      slug: SLUG,
      title: "蜜罐測試講座",
      description: "測試用",
      lectureUrl: "https://us02web.zoom.us/j/00000000000",
      emailSubject: "測試",
      emailBody: "連結：{link}",
      isActive: true,
    },
  });

  console.log("\n【1】觸發判定：空白不算，有值才算（判錯就是自己製造誤殺）");
  check("未填 → 不觸發", !isHoneypotTripped(""));
  check("null → 不觸發", !isHoneypotTripped(null));
  check("整串空白／換行 → 不觸發", !isHoneypotTripped("   \n\t "));
  check("有值 → 觸發", isHoneypotTripped("密碼管理器亂填的值"));

  console.log("\n【2】對外的成功字串要與正常寄出可分辨");
  check(
    "蜜罐訊息不含「垃圾郵件夾」（唯一能從截圖分辨路徑的線索）",
    HONEYPOT_SUCCESS_MESSAGE === "確認信已寄出，請到信箱查收！" &&
      !HONEYPOT_SUCCESS_MESSAGE.includes("垃圾郵件夾"),
    HONEYPOT_SUCCESS_MESSAGE,
  );

  console.log("\n【3】擋下時留痕（這就是兩起事故查不出來的根因）");
  await recordBlockedWebinarAttempt(SLUG, {
    name: "齊測試",
    email: VICTIM.toUpperCase(), // 大寫進來也要正規化，否則補寄比對不到
    phone: "0933632036",
  });
  check(
    "不進索取名單（名單不能被疑似機器人污染）",
    (await prisma.webinarRequest.count({ where: { webinarId: webinar.id } })) === 0,
  );
  const attempts = await prisma.webinarBlockedAttempt.findMany({
    where: { webinarId: webinar.id },
  });
  check("**留下了擋下紀錄**", attempts.length === 1);
  check("email 正規化成小寫，補寄才對得上", attempts[0]?.email === VICTIM);
  check("保留姓名與手機", attempts[0]?.name === "齊測試" && attempts[0]?.phone === "0933632036");
  check("預設未結案（後台才看得到）", attempts[0]?.resolvedAt === null);

  console.log("\n【4】講座不存在時安靜跳過，絕不 throw（防機器人路徑不能變成錯誤來源）");
  let threw = false;
  await recordBlockedWebinarAttempt("slug-does-not-exist", { email: "x@y.com" }).catch(
    () => (threw = true),
  );
  check("不存在的 slug 不會 throw", !threw);

  // 補寄的「寄送成功」分支需要真的寄信，測試一律不做（見上方第二道鎖）。
  // 那條路徑與訪客正常登記共用 buildWebinarMail → sendBroadcast，
  // 由 check-webinar-mail-refactor 逐字釘住；這裡守的是失敗時的行為。
  console.log("\n【5】後台補寄：寄不出去的時候絕不能假裝處理完了");
  const resent = await resendBlockedWebinarAttempt(attempts[0].id);
  if (resent.error) {
    // 本機沒有 RESEND_API_KEY 時走寄送失敗分支——那正是最該守住的邊界
    check(
      "寄送失敗時**不結案**，管理員可以再試（不能吞第二次）",
      (await prisma.webinarBlockedAttempt.findUnique({ where: { id: attempts[0].id } }))
        ?.resolvedAt === null,
      resent.error,
    );
    check(
      "寄送失敗時也不會先把人寫進名單（名單 ≠ 已寄出）",
      (await prisma.webinarRequest.count({ where: { webinarId: webinar.id } })) === 0,
    );
    console.log("    （本機無 RESEND_API_KEY，走的是寄送失敗分支——這正是要驗的邊界）");
  } else {
    check("補寄成功", !!resent.success, JSON.stringify(resent));
    const req = await prisma.webinarRequest.findFirst({ where: { webinarId: webinar.id } });
    check("已補進索取名單", req?.email === VICTIM);
    check("姓名與手機一併帶過去", req?.name === "齊測試" && req?.phone === "0933632036");
    check(
      "擋下紀錄已結案",
      !!(await prisma.webinarBlockedAttempt.findUnique({ where: { id: attempts[0].id } }))
        ?.resolvedAt,
    );
    check(
      "重複按補寄會被擋（不會寄第二封、不會重複計數）",
      !!(await resendBlockedWebinarAttempt(attempts[0].id)).error,
    );
  }

  console.log("\n【6】沒有 Email 的擋下紀錄補寄不了，要明講而不是靜靜失敗");
  await recordBlockedWebinarAttempt(SLUG, { name: "bot", email: "", phone: "" });
  const noEmail = await prisma.webinarBlockedAttempt.findFirst({
    where: { webinarId: webinar.id, email: null },
  });
  check("沒有 email 的紀錄也留下了", !!noEmail);
  const r2 = await resendBlockedWebinarAttempt(noEmail!.id);
  check("補寄回報錯誤而非假裝成功", !!r2.error, JSON.stringify(r2));

  console.log("\n【7】確認是機器人：忽略只結案、不寄信不進名單");
  const before = await prisma.webinarRequest.count({ where: { webinarId: webinar.id } });
  await dismissBlockedWebinarAttempt(noEmail!.id);
  check(
    "忽略後已結案",
    !!(await prisma.webinarBlockedAttempt.findUnique({ where: { id: noEmail!.id } }))
      ?.resolvedAt,
  );
  check(
    "忽略不會把機器人寫進名單",
    (await prisma.webinarRequest.count({ where: { webinarId: webinar.id } })) === before,
  );

  console.log("\n【8】刪講座時擋下紀錄一併清掉（cascade，不留孤兒個資）");
  await prisma.webinar.delete({ where: { id: webinar.id } });
  check(
    "講座刪除後沒有孤兒紀錄",
    (await prisma.webinarBlockedAttempt.count({ where: { webinarId: webinar.id } })) === 0,
  );

  console.log(`\n${pass} 過 / ${fail} 失敗`);
  await prisma.$disconnect();
  if (fail > 0) process.exit(1);
}

main().catch(async (e) => {
  console.error(e);
  await prisma.webinar.deleteMany({ where: { slug: SLUG } }).catch(() => undefined);
  await prisma.$disconnect();
  process.exit(1);
});
