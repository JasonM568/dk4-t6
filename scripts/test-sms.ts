// 簡訊模組驗證腳本（本機 DB，dry-run，不會發出任何簡訊、不呼叫任何外部 API）
//
//   npx tsx --conditions=react-server scripts/test-sms.ts
//
// 需要 --conditions=react-server：dispatch.ts 是 server-only，
// 純 node 環境下 server-only 套件會 throw（它的 exports 只在 react-server 條件下是空實作）。

import { normalizeMobile, explainMobile, formatMobile } from "../src/lib/sms/phone";
import { countSms, composeSmsText, hasEmoji } from "../src/lib/sms/message";
import { prisma } from "../src/lib/db";
import {
  previewSmsAudience,
  executeSmsBroadcast,
} from "../src/lib/sms/dispatch";
import { setSmsSetting } from "../src/lib/sms/settings";

const TAG = "__smstest__";
let ok = 0;
let bad = 0;

function check(label: string, actual: unknown, expected: unknown) {
  const pass = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(
    `${pass ? "✅" : "❌"} ${label}：${JSON.stringify(actual)}${
      pass ? "" : ` ← 預期 ${JSON.stringify(expected)}`
    }`,
  );
  if (pass) ok++;
  else bad++;
}

// ── 1. 手機正規化 ──────────────────────────────────────────────
console.log("\n── 1. 手機號碼正規化 ─────────────────────────");
const NORMALIZE_CASES: [string, string | null][] = [
  // 標準
  ["0912345678", "0912345678"],
  // 分隔符
  ["0912-345-678", "0912345678"],
  ["0912 345 678", "0912345678"],
  ["(0912)345678", "0912345678"],
  ["0912.345.678", "0912345678"],
  // 全形
  ["０９１２３４５６７８", "0912345678"],
  // 國際冠碼
  ["+886912345678", "0912345678"],
  ["886912345678", "0912345678"],
  ["00886912345678", "0912345678"],
  ["+886-912-345-678", "0912345678"],
  // Excel 掉前導零
  ["912345678", "0912345678"],
  // 前後空白
  ["  0912345678  ", "0912345678"],
  // 應拒絕
  ["02-2700-1234", null], // 市話
  ["0227001234", null], // 市話
  ["227001234", null], // 市話掉零 → 刻意不猜
  ["0912345678#123", null], // 分機
  ["0912345678 0987654321", null], // 一格兩號
  ["091234567", null], // 太短
  ["09123456789", null], // 太長
  ["", null],
  ["   ", null],
  ["N/A", null],
  ["無", null],
  ["0812345678", null], // 08 開頭非手機
  [null as unknown as string, null],
  [undefined as unknown as string, null],
];
for (const [input, expected] of NORMALIZE_CASES) {
  check(`normalizeMobile(${JSON.stringify(input)})`, normalizeMobile(input), expected);
}

console.log("\n── 2. 拒絕理由 ───────────────────────────────");
check("市話理由", explainMobile("02-2700-1234").reject, "LANDLINE");
check("太長理由", explainMobile("09123456789").reject, "TOO_LONG");
check("太短理由", explainMobile("091234567").reject, "TOO_SHORT");
check("空白理由", explainMobile("").reject, "EMPTY");
check("顯示格式", formatMobile("0912345678"), "0912-345-678");
check("空值顯示", formatMobile(null), "—");

// ── 3. 字數與則數 ─────────────────────────────────────────────
console.log("\n── 3. 字數與則數（中文 70/則，分段 67）────────");
check("空字串 0 則", countSms("").segments, 0);
check("純英數 160 字 = 1 則", countSms("a".repeat(160)).segments, 1);
check("純英數 161 字 = 2 則", countSms("a".repeat(161)).segments, 2);
check("中文 70 字 = 1 則", countSms("測".repeat(70)).segments, 1);
check("中文 71 字 = 2 則", countSms("測".repeat(71)).segments, 2);
check("中文 134 字 = 2 則", countSms("測".repeat(134)).segments, 2);
check("中文 135 字 = 3 則", countSms("測".repeat(135)).segments, 3);
check("中文編碼判定", countSms("測試").encoding, "UCS2");
check("英數編碼判定", countSms("hello").encoding, "GSM7");
check("中英混雜算 UCS2", countSms("hello 測試").encoding, "UCS2");
check("emoji 偵測", hasEmoji("上課提醒 🎉"), true);
check("無 emoji", hasEmoji("上課提醒"), false);

console.log("\n── 4. 合規文案組裝 ───────────────────────────");
const noticeText = composeSmsText("明天 9:00 台北場記得出席", {
  messageType: "NOTICE",
  brandPrefix: "【希望學院】",
  optOutUrl: "https://course.huangxi.info/u/ABCD1234",
});
check("履約通知不帶退訂連結", noticeText.includes("拒收"), false);
check("履約通知有品牌前綴", noticeText.startsWith("【希望學院】"), true);
const mktText = composeSmsText("新課上架", {
  messageType: "MARKETING",
  brandPrefix: "【希望學院】",
  optOutUrl: "https://course.huangxi.info/u/ABCD1234",
});
check("行銷簡訊帶退訂連結", mktText.includes("拒收 https://"), true);
console.log(
  `   合規行銷簡訊實測：「${mktText}」→ ${countSms(mktText).length} 字 / ${countSms(mktText).segments} 則`,
);

// ── 5. 端到端 dry-run ─────────────────────────────────────────
async function main() {
  console.log("\n── 5. 端到端 dry-run（本機 DB）────────────────");


  async function cleanup() {
    await prisma.smsBroadcast.deleteMany({ where: { title: { startsWith: TAG } } });
    await prisma.courseSession.deleteMany({ where: { title: { startsWith: TAG } } });
    await prisma.smsOptOut.deleteMany({ where: { mobile: { in: ["0900000001"] } } });
  }
  await cleanup();

  // 場次 A：4 筆報名 — 2 筆正常、1 筆市話（收不到）、1 筆沒填
  const sessionA = await prisma.courseSession.create({
    data: {
      title: `${TAG}AI初階 台北場`,
      signups: {
        create: [
          { orderNo: `${TAG}1`, name: "王小明", phone: "0912345678" },
          { orderNo: `${TAG}2`, name: "李小美", phone: "0900000001" }, // 稍後設為退訂
          { orderNo: `${TAG}3`, name: "陳大文", phone: "02-2700-1234" }, // 市話
          { orderNo: `${TAG}4`, name: "無電話者", phone: null },
        ],
      },
    },
  });
  // 場次 B：與 A 有一位重複報名（王小明），姓名不同以驗證優先序
  const sessionB = await prisma.courseSession.create({
    data: {
      title: `${TAG}量子思維 台北場`,
      signups: {
        create: [
          { orderNo: `${TAG}5`, name: "王小明（量子班）", phone: "0912-345-678" },
          { orderNo: `${TAG}6`, name: "張三", phone: "0955555555" },
        ],
      },
    },
  });

  const preview = await previewSmsAudience({
    audienceType: "SESSION",
    sessionIds: [sessionA.id, sessionB.id],
    messageType: "NOTICE",
  });
  check("各場次原始筆數", preview.sources.map((s) => s.rowCount), [4, 2]);
  check("合計筆數", preview.totalRows, 6);
  check("無手機/市話人數", preview.noMobileCount, 2);
  check("去重後不重複手機", preview.uniqueCount, 3);
  check("跨場次重複筆數", preview.duplicateCount, 1);
  check("實際可發", preview.sendableCount, 3);

  // 退訂測試：0900000001 標為 USER 退訂 —— NOTICE 不該被擋
  await prisma.smsOptOut.create({
    data: { mobile: "0900000001", source: "USER", reason: "測試" },
  });
  const noticePreview = await previewSmsAudience({
    audienceType: "SESSION",
    sessionIds: [sessionA.id],
    messageType: "NOTICE",
  });
  check("行銷退訂不擋履約通知", noticePreview.sendableCount, 2);
  const mktPreview = await previewSmsAudience({
    audienceType: "SESSION",
    sessionIds: [sessionA.id],
    messageType: "MARKETING",
  });
  check("行銷簡訊會扣掉退訂者", mktPreview.sendableCount, 1);
  check("行銷退訂人數", mktPreview.optedOutCount, 1);

  // INVALID 對兩者都該擋
  await prisma.smsOptOut.update({
    where: { mobile: "0900000001" },
    data: { source: "INVALID" },
  });
  const invalidPreview = await previewSmsAudience({
    audienceType: "SESSION",
    sessionIds: [sessionA.id],
    messageType: "NOTICE",
  });
  check("空號連履約通知也擋", invalidPreview.sendableCount, 1);
  await prisma.smsOptOut.deleteMany({ where: { mobile: "0900000001" } });

  // 實際 dry-run 發送
  await setSmsSetting("singleSendLimit", "500");
  await setSmsSetting("dailyLimit", "2000");
  await setSmsSetting("pricePerSegment", "1.0");

  const rec = await prisma.smsBroadcast.create({
    data: {
      title: `${TAG}上課提醒`,
      body: "{name} 您好，明天 9:00 台北場記得準時出席。",
      messageType: "NOTICE",
      audienceType: "SESSION",
      sessionIds: [sessionA.id, sessionB.id],
      status: "SENDING",
      claimedAt: new Date(),
    },
  });
  const result = await executeSmsBroadcast(rec.id);
  const after = await prisma.smsBroadcast.findUniqueOrThrow({ where: { id: rec.id } });
  check("dry-run 發送成功數", after.sentCount, 3);
  check("預覽人數 == 實際發送數", preview.sendableCount, after.sentCount);
  check("provider 記為 dryrun", after.provider, "dryrun");
  check("測試模式金額為 0", after.estimatedCostCents, 0);
  check("名單快照無重複", after.recipients.length, new Set(after.recipients).size);
  check("無手機人數已記錄", after.noMobileCount, 2);
  check("狀態 SENT", after.status, "SENT");
  if (result.error) console.log("   error:", result.error);

  // 姓名優先序：王小明在 A 叫「王小明」、B 叫「王小明（量子班）」，勾選順序 [A,B] 應取 A
  check(
    "跨場次重複者取先勾選場次的姓名",
    after.recipients.includes("0912345678"),
    true,
  );

  // ── 6. 花費上限 ───────────────────────────────────────────────
  console.log("\n── 6. 花費上限（超過一律整批不送）────────────");
  await setSmsSetting("singleSendLimit", "1");
  const overRec = await prisma.smsBroadcast.create({
    data: {
      title: `${TAG}超過上限`,
      body: "測試",
      messageType: "NOTICE",
      audienceType: "SESSION",
      sessionIds: [sessionA.id, sessionB.id],
      status: "SENDING",
      claimedAt: new Date(),
    },
  });
  const overResult = await executeSmsBroadcast(overRec.id);
  const overAfter = await prisma.smsBroadcast.findUniqueOrThrow({
    where: { id: overRec.id },
  });
  check("超過上限零發送", overAfter.sentCount, 0);
  check("超過上限狀態 FAILED", overAfter.status, "FAILED");
  check("超過上限有中文原因", (overResult.error ?? "").includes("超過單次上限"), true);
  await setSmsSetting("singleSendLimit", "500");

  await cleanup();

}

main()
  .then(() => {
    console.log(`\n═══ 通過 ${ok} 項，失敗 ${bad} 項 ═══`);
    process.exit(bad === 0 ? 0 : 1);
  })
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
