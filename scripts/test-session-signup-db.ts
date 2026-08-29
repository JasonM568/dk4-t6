/* 場次公開報名頁（Phase 1）的驗證（會寫入資料庫，**只能對本機 localhost 跑**）。
 *
 * 驗的是這次改動最危險的三件事：
 *   ① 待確認報名**不會**出現在正式名單（污染看板/分組/課前通知的口徑）
 *   ② 名額與開放時間的邊界（超賣、報名期已過還收得到）
 *   ③ 同行者不會被當成同一個人（撞名判定）與重複報名擋不擋得住
 * 純函式走 signupState/remainingSeats 本尊，DB 行為走 Prisma 實際讀寫。
 * 跑法：npx tsx --conditions=react-server scripts/test-session-signup-db.ts
 * 測完會刪掉自己建的場次與報名列。 */
import { prisma } from "../src/lib/db";
import {
  signupState,
  remainingSeats,
  makeWebOrderNo,
  attendeeKeyAt,
  WEB_ORDER_PREFIX,
  SIGNUP_REQUEST_STATUS,
} from "../src/lib/session-signup-page";
import { isSamePerson } from "../src/lib/session-roster";

// 安全鎖：非本機資料庫一律拒跑（鐵則：絕不對正式站跑寫入測試）
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
    console.log(`  ✗ ${name}${detail ? `：${detail}` : ""}`);
  }
}

const SID = "test-signup-session";
const DAY = 24 * 60 * 60 * 1000;

async function cleanup() {
  await prisma.sessionSignupRequest.deleteMany({ where: { sessionId: SID } });
  await prisma.sessionSignup.deleteMany({ where: { sessionId: SID } });
  await prisma.courseSession.deleteMany({ where: { id: SID } });
}

const baseSession = {
  isSignupOpen: true,
  signupOpenAt: null,
  signupCloseAt: null,
  eventDate: null,
  endDate: null,
  signupQuota: null,
};
const now = new Date("2026-09-01T03:00:00Z"); // 台北 11:00

async function main() {
  await cleanup();

  console.log("\n開放狀態判定（純函式）");
  {
    const closed = signupState({ session: { ...baseSession, isSignupOpen: false }, taken: 0, now });
    check("總開關關閉 → CLOSED", !closed.open && closed.reason === "CLOSED");

    const notYet = signupState({
      session: { ...baseSession, signupOpenAt: new Date(now.getTime() + DAY) },
      taken: 0,
      now,
    });
    check("尚未開始 → NOT_YET", !notYet.open && notYet.reason === "NOT_YET");

    const ended = signupState({
      session: { ...baseSession, signupCloseAt: new Date(now.getTime() - DAY) },
      taken: 0,
      now,
    });
    check("已過截止 → ENDED", !ended.open && ended.reason === "ENDED");

    // 沒設截止時間就以開課日兜底：課上完了還開著報名是最容易漏掉的失誤
    const past = signupState({
      session: { ...baseSession, eventDate: new Date(now.getTime() - 2 * DAY) },
      taken: 0,
      now,
    });
    check("沒設截止、開課日已過 → ENDED", !past.open && past.reason === "ENDED");

    // 開課「當天」仍可報名（台北時間當日 23:59 前）
    const today = signupState({
      session: { ...baseSession, eventDate: new Date("2026-09-01T00:00:00Z") },
      taken: 0,
      now,
    });
    check("開課當天仍開放", today.open);

    const full = signupState({ session: { ...baseSession, signupQuota: 10 }, taken: 10, now });
    check("已滿額 → FULL", !full.open && full.reason === "FULL");

    const nearly = signupState({ session: { ...baseSession, signupQuota: 10 }, taken: 9, now });
    check("剩 1 位仍開放", nearly.open);

    check("不限額時 remainingSeats 回 null", remainingSeats(null, 99) === null);
    check("超額時剩餘夾到 0", remainingSeats(5, 8) === 0);
  }

  console.log("\n訂單編號與參加者識別鍵");
  {
    const a = makeWebOrderNo();
    const b = makeWebOrderNo();
    check("前綴為 WEB-（不與 1shop／手動-／ONSITE- 相撞）", a.startsWith(WEB_ORDER_PREFIX));
    check("兩次產生不重複", a !== b);
    check("不含易混字元 I/O", !/[IO]/.test(a.slice(WEB_ORDER_PREFIX.length)));
    check("第一位是 buyer", attendeeKeyAt(0) === "buyer");
    check("第二位是 companion-1", attendeeKeyAt(1) === "companion-1");
  }

  console.log("\n同行者辨識（學員記錄卡併卡的來源）");
  {
    check(
      "同名但手機不同 → 不同人",
      !isSamePerson({ name: "陳美玲", phone: "0912345678" }, { name: "陳美玲", phone: "0987654321" }),
    );
    check(
      "同名同手機 → 同一人",
      isSamePerson({ name: "陳美玲", phone: "0912345678" }, { name: "陳美玲", phone: "0912345678" }),
    );
    check(
      "同名、其中一方沒手機 → 視為同一人（保守擋下）",
      isSamePerson({ name: "陳美玲", phone: null }, { name: "陳美玲", phone: "0912345678" }),
    );
    check(
      "不同名 → 不同人",
      !isSamePerson({ name: "陳美玲", phone: "0912345678" }, { name: "王大明", phone: "0912345678" }),
    );
  }

  await prisma.courseSession.create({
    data: {
      id: SID,
      title: "測試場次－公開報名頁",
      keywords: ["測試報名"],
      signupSlug: "test-signup-page",
      isSignupOpen: true,
      signupQuota: 3,
    },
  });

  console.log("\n待確認報名不得污染正式名單");
  {
    const orderNo = makeWebOrderNo();
    await prisma.sessionSignupRequest.createMany({
      data: [
        {
          sessionId: SID, orderNo, attendeeKey: "buyer",
          name: "報名甲", phone: "0900000201", email: "a@example.com",
          meal: "MEAT", isRetrain: false,
          buyerName: "報名甲", buyerEmail: "a@example.com", buyerPhone: "0900000201",
        },
        {
          sessionId: SID, orderNo, attendeeKey: "companion-1",
          name: "同行乙", phone: "0900000202", email: null,
          meal: "VEG", isRetrain: true,
          buyerName: "報名甲", buyerEmail: "a@example.com", buyerPhone: "0900000201",
        },
      ],
    });

    const roster = await prisma.sessionSignup.count({ where: { sessionId: SID } });
    check("送出報名後正式名單仍為 0（看板/分組/課前通知不受影響）", roster === 0);

    const pending = await prisma.sessionSignupRequest.count({
      where: { sessionId: SID, status: SIGNUP_REQUEST_STATUS.PENDING },
    });
    check("待確認列為 2（訂購人＋同行者各一列）", pending === 2, `實際 ${pending}`);

    // 名額佔位：待確認也要算，否則會超賣
    const taken = roster + pending;
    check("名額計算含待確認 → 剩 1 位", remainingSeats(3, taken) === 1);

    // 模擬「確認收款 → 轉入名單」（與 confirmSignupRequestAction 同一組寫入）
    const requests = await prisma.sessionSignupRequest.findMany({
      where: { sessionId: SID, orderNo, status: SIGNUP_REQUEST_STATUS.PENDING },
      orderBy: { attendeeKey: "asc" },
    });
    for (const r of requests) {
      const product = r.isRetrain ? "複訓｜網路報名" : "網路報名";
      const signup = await prisma.sessionSignup.create({
        data: {
          sessionId: SID, orderNo: r.orderNo, attendeeKey: r.attendeeKey,
          name: r.name, email: r.email, phone: r.phone,
          product, meal: r.meal, orderedAt: r.createdAt,
        },
      });
      await prisma.sessionSignupRequest.update({
        where: { id: r.id },
        data: {
          status: SIGNUP_REQUEST_STATUS.CONFIRMED,
          confirmedAt: new Date(),
          signupId: signup.id,
        },
      });
    }

    const afterRoster = await prisma.sessionSignup.findMany({
      where: { sessionId: SID },
      orderBy: { attendeeKey: "asc" },
    });
    check("轉入後正式名單 2 人", afterRoster.length === 2, `實際 ${afterRoster.length}`);
    check(
      "報名時勾複訓 → product 帶「複訓」（全站舊生判別吃這個字）",
      afterRoster.find((s) => s.name === "同行乙")?.product?.includes("複訓") === true,
    );
    check("葷素正確帶入", afterRoster.find((s) => s.name === "同行乙")?.meal === "VEG");
    check(
      "訂購人與同行者是兩列不同 attendeeKey",
      new Set(afterRoster.map((s) => s.attendeeKey)).size === 2,
    );

    const stillPending = await prisma.sessionSignupRequest.count({
      where: { sessionId: SID, status: SIGNUP_REQUEST_STATUS.PENDING },
    });
    check("轉入後不再是待確認", stillPending === 0);
  }

  console.log("\n重複報名與唯一鍵");
  {
    const dupOrder = makeWebOrderNo();
    await prisma.sessionSignupRequest.create({
      data: {
        sessionId: SID, orderNo: dupOrder, attendeeKey: "buyer",
        name: "重複丙", phone: "0900000203",
        buyerName: "重複丙", buyerEmail: "c@example.com",
      },
    });
    let blocked = false;
    try {
      await prisma.sessionSignupRequest.create({
        data: {
          sessionId: SID, orderNo: dupOrder, attendeeKey: "buyer",
          name: "重複丙", phone: "0900000203",
          buyerName: "重複丙", buyerEmail: "c@example.com",
        },
      });
    } catch {
      blocked = true;
    }
    check("同場次同訂單同參加者鍵撞唯一鍵（重送不會重複建列）", blocked);

    // 已在正式名單的人再報一次：應被 isSamePerson 擋下
    const roster = await prisma.sessionSignup.findMany({
      where: { sessionId: SID, deferredToSessionId: null },
      select: { name: true, phone: true },
    });
    const again = { name: "報名甲", phone: "0900000201" };
    check("已在正式名單的人重複報名會被辨識出來", roster.some((r) => isSamePerson(r, again)));
  }

  await cleanup();
  console.log(`\n${fail === 0 ? "✓ 全數通過" : "✗ 有失敗項目"}：${pass} 通過 / ${fail} 失敗`);
  await prisma.$disconnect();
  process.exit(fail === 0 ? 0 : 1);
}

main().catch(async (e) => {
  console.error(e);
  await cleanup();
  await prisma.$disconnect();
  process.exit(1);
});
