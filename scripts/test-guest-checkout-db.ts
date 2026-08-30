/* 訪客購課 → 付款成功自動開通 的驗證（會寫入資料庫，**只能對本機 localhost 跑**）。
 *
 * 驗最重要的幾件事：
 *   ① 訪客訂單（userId=null）付款成功後，userId 被回填、Enrollment 建立 → 買了就看得到
 *   ② 冪等：重送付款通知不重複開通、不重複累計消費
 *   ③ 建帳號失敗（測試環境沒有 Supabase 金鑰時）不會把錢吃掉——改存 PendingEnrollment，
 *      日後該 email 有帳號時由 claimPendingEnrollments 補開通
 *   ④ 金額不符一律拒絕結算
 * 跑法：npx tsx --conditions=react-server scripts/test-guest-checkout-db.ts */
import { prisma } from "../src/lib/db";
import { settlePaidOrder, __setGuestProvisionerForTest } from "../src/lib/payment/settle";
import { claimPendingEnrollments } from "../src/lib/pending-enroll";

const url = process.env.DATABASE_URL ?? "";
if (!/@(localhost|127\.0\.0\.1)[:/]/.test(url)) {
  console.error("✗ DATABASE_URL 不是本機資料庫，拒絕執行（此測試會寫入）");
  process.exit(1);
}

// 鐵則：測試絕不對正式 Supabase 建帳號、也不透過 Resend 真寄信。
// 建帳號與通知信一律注入假實作，只驗本機 DB 的行為。
const FAKE_USER = "00000000-0000-4000-8000-00000000beef";
let provisionCalls = 0;
let notifyCalls = 0;
let provisionShouldFail = false;
__setGuestProvisionerForTest(
  async () => {
    provisionCalls++;
    return provisionShouldFail
      ? { ok: false as const, error: "測試模擬建帳號失敗" }
      : { ok: true as const, userId: FAKE_USER, created: true };
  },
  async () => {
    notifyCalls++;
  },
);

let pass = 0;
let fail = 0;
function check(name: string, ok: boolean, detail?: string) {
  if (ok) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}${detail ? `：${detail}` : ""}`); }
}

const COURSE_ID = "test-guest-course";
const EMAIL = "guest-test@localhost.test";

async function cleanup() {
  await prisma.enrollment.deleteMany({ where: { courseId: COURSE_ID } });
  await prisma.pendingEnrollment.deleteMany({ where: { courseId: COURSE_ID } });
  await prisma.orderItem.deleteMany({ where: { courseId: COURSE_ID } });
  await prisma.payment.deleteMany({ where: { order: { buyerEmail: EMAIL } } });
  await prisma.order.deleteMany({ where: { buyerEmail: EMAIL } });
  await prisma.memberStats.deleteMany({ where: { userId: FAKE_USER } });
  await prisma.course.deleteMany({ where: { id: COURSE_ID } });
}

async function newGuestOrder(total = 1000) {
  const orderNo = `GT${Date.now().toString().slice(-10)}${Math.floor(Math.random() * 900 + 100)}`;
  const o = await prisma.order.create({
    data: {
      orderNo,
      checkoutKey: `guest:${EMAIL}:${COURSE_ID}:${orderNo}`,
      userId: null, // ← 訪客訂單
      buyerEmail: EMAIL,
      buyerName: "訪客測試",
      buyerPhone: "0912345678",
      status: "PENDING",
      subtotal: total,
      discount: 0,
      total,
      items: { create: [{ courseId: COURSE_ID, unitPrice: total }] },
      payment: { create: { provider: "payuni", status: "PENDING", amount: total } },
    },
  });
  return { orderNo, id: o.id };
}

async function main() {
  await cleanup();
  await prisma.course.create({
    data: {
      id: COURSE_ID,
      slug: "test-guest-course",
      title: "訪客購課測試",
      description: "測試用，跑完會刪",
      price: 1000,
    },
  });

  // ① 訪客下單 → 付款成功 → 自動建帳號、回填 userId、開通課程
  {
    const { orderNo } = await newGuestOrder();
    const before = await prisma.order.findUnique({ where: { orderNo } });
    check("訪客訂單可建立且 userId 為 null", before !== null && before.userId === null);

    const res = await settlePaidOrder({ orderNo, amount: 1000, raw: { t: "1" } });
    const after = await prisma.order.findUnique({ where: { orderNo } });
    check("結算回報成功", res.ok, JSON.stringify(res));
    check("訂單標 PAID", after?.status === "PAID", after?.status);
    check("userId 已回填（自動註冊）", after?.userId === FAKE_USER, after?.userId ?? "null");
    check("有呼叫建帳號", provisionCalls === 1, `calls=${provisionCalls}`);

    const enrolled = await prisma.enrollment.findUnique({
      where: { userId_courseId: { userId: FAKE_USER, courseId: COURSE_ID } },
    });
    check("課程已開通（買了就看得到）", !!enrolled);
    check("開通來源標 PURCHASE", enrolled?.source === "PURCHASE", enrolled?.source ?? "無");

    const stats = await prisma.memberStats.findUnique({ where: { userId: FAKE_USER } });
    check("消費金額有累計", stats?.totalSpent === 1000, String(stats?.totalSpent));
    check("有寄出購課通知信（新帳號）", notifyCalls === 1, `calls=${notifyCalls}`);

    // ② 冪等：重送付款通知不重複開通、不重複累計、不重複寄信
    const again = await settlePaidOrder({ orderNo, amount: 1000, raw: { t: "1" } });
    check("重送付款通知 → already（冪等）", again.ok && "already" in again && again.already);
    const stats2 = await prisma.memberStats.findUnique({ where: { userId: FAKE_USER } });
    check("重送後消費金額不重複累計", stats2?.totalSpent === 1000, String(stats2?.totalSpent));
    check("重送後不重複寄信", notifyCalls === 1, `calls=${notifyCalls}`);
  }

  // ③ 建帳號失敗（Supabase 掛掉等）→ 錢不能白收：改存待開通名單，日後認領補開通
  {
    await prisma.enrollment.deleteMany({ where: { courseId: COURSE_ID } });
    await prisma.memberStats.deleteMany({ where: { userId: FAKE_USER } });
    provisionShouldFail = true;
    const { orderNo } = await newGuestOrder();
    const res = await settlePaidOrder({ orderNo, amount: 1000, raw: {} });
    const o = await prisma.order.findUnique({ where: { orderNo } });
    check("建帳號失敗仍標 PAID（保留金流事實）", o?.status === "PAID", o?.status);
    check("建帳號失敗 → userId 維持 null", o?.userId === null);
    check("建帳號失敗 → 不會誤發 Enrollment", !(await prisma.enrollment.findFirst({ where: { courseId: COURSE_ID } })));
    const pendingRow = await prisma.pendingEnrollment.findFirst({
      where: { courseId: COURSE_ID, email: EMAIL },
    });
    check("建帳號失敗 → 存待開通名單（錢不會白收）", !!pendingRow);
    check("結算仍回報成功（不讓金流一直重送）", res.ok);

    // 日後該 email 有帳號 → 自動補開通
    const claimed = await claimPendingEnrollments(EMAIL, FAKE_USER);
    const nowEnrolled = await prisma.enrollment.findUnique({
      where: { userId_courseId: { userId: FAKE_USER, courseId: COURSE_ID } },
    });
    check("帳號出現後自動補開通", claimed === 1 && !!nowEnrolled, `claimed=${claimed}`);
    provisionShouldFail = false;
  }

  // ④ 金額不符一律拒絕
  {
    await prisma.enrollment.deleteMany({ where: { courseId: COURSE_ID } });
    const { orderNo } = await newGuestOrder();
    const res = await settlePaidOrder({ orderNo, amount: 1, raw: {} });
    const o = await prisma.order.findUnique({ where: { orderNo } });
    check("金額不符 → 拒絕結算", !res.ok && "reason" in res && res.reason === "AMOUNT_MISMATCH");
    check("金額不符 → 訂單維持 PENDING", o?.status === "PENDING", o?.status);
    check("金額不符 → 不建帳號", o?.userId === null);
  }

  await cleanup();
  console.log(`\n訪客購課：${pass} 通過 / ${fail} 失敗`);
  await prisma.$disconnect();
  process.exit(fail === 0 ? 0 : 1);
}

main().catch(async (e) => {
  console.error(e);
  await cleanup().catch(() => {});
  await prisma.$disconnect();
  process.exit(1);
});
