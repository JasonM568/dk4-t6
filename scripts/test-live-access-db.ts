/* /live 查看碼閘門驗證（會寫入資料庫，**只能對本機 localhost 跑**）。
 *
 * 這是一個公開頁面上的鎖，所以驗的是「拿不到的人真的拿不到」：
 * 跨場次重放、改碼後的舊 cookie、竄改的簽章、過期。
 * 跑法：npx tsx --conditions=react-server scripts/test-live-access-db.ts
 *（live-auth.ts 是 server-only，純 node 條件下該套件會 throw）
 * 測完會刪掉自己建的場次。 */
import { prisma } from "../src/lib/db";
import { signLiveToken, verifyLiveToken } from "../src/lib/live-auth";
import { buildJoinUrl, isSafeHttpUrl } from "../src/lib/meeting";

if (!/@(localhost|127\.0\.0\.1)[:/]/.test(process.env.DATABASE_URL ?? "")) {
  console.error("✗ DATABASE_URL 不是本機資料庫，拒絕執行（此測試會寫入）");
  process.exit(1);
}
// 簽章需要 secret：測試用固定字串，與正式站無關
process.env.BOARD_SESSION_SECRET ??= "x".repeat(48);

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

const TAG = "live-test";

async function main() {
  await prisma.courseSession.deleteMany({ where: { title: { startsWith: TAG } } });

  const a = await prisma.courseSession.create({
    data: { title: `${TAG} A 場`, keywords: [], accessCode: "9001" },
  });
  const b = await prisma.courseSession.create({
    data: { title: `${TAG} B 場`, keywords: [], accessCode: "9002" },
  });

  try {
    const codeOf = (id: string) => (id === a.id ? "9001" : id === b.id ? "9002" : null);

    console.log("\n正常流程");
    const signed = signLiveToken(a.id, "9001");
    check("簽得出 token", !!signed);
    const ok = signed && verifyLiveToken(signed.token, codeOf);
    check("驗得過，且綁的是 A 場", !!ok && ok.sessionId === a.id, `實際 ${ok?.sessionId}`);

    console.log("\n拿不到的人真的拿不到");
    // A 場的 cookie 不能拿來看 B 場：token 綁 sessionId，且簽章涵蓋它
    const forged = signed!.token.replace(a.id, b.id);
    check(
      "把 token 裡的場次 id 換成 B 場 → 驗不過",
      verifyLiveToken(forged, codeOf) === null,
    );
    check(
      "A 場 token 用 B 場的碼查 → 驗不過",
      verifyLiveToken(signed!.token, () => "9002") === null,
    );
    // 管理員改碼／清碼後，已發出的 cookie 必須立刻失效
    check(
      "管理員改碼後舊 token 失效",
      verifyLiveToken(signed!.token, () => "9999") === null,
    );
    check(
      "碼被清掉（關閉索取）後舊 token 失效",
      verifyLiveToken(signed!.token, () => null) === null,
    );
    // 竄改簽章的最後一碼
    const tampered = signed!.token.slice(0, -1) + (signed!.token.endsWith("a") ? "b" : "a");
    check("竄改簽章 → 驗不過", verifyLiveToken(tampered, codeOf) === null);
    check("格式不對 → 驗不過", verifyLiveToken("garbage", codeOf) === null);
    check(
      "已過期的 token → 驗不過",
      verifyLiveToken(`lv1.${a.id}.${Date.now() - 1000}.` + "0".repeat(16) + "." + "0".repeat(64), codeOf) === null,
    );
    // 網域分離：board 的 token 格式（4 段）在這裡一律不接受
    check(
      "board token 格式 → 驗不過",
      verifyLiveToken(`v1.${Date.now() + 60000}.${"0".repeat(16)}.${"0".repeat(64)}`, codeOf) === null,
    );

    console.log("\n查看碼唯一");
    let dup = false;
    try {
      await prisma.courseSession.create({
        data: { title: `${TAG} C 場`, keywords: [], accessCode: "9001" },
      });
    } catch {
      dup = true;
    }
    check("兩個場次不能用同一組碼", dup);
    // 沒設碼的場次可以有很多個（Postgres 唯一索引允許多個 NULL）
    const n1 = await prisma.courseSession.create({
      data: { title: `${TAG} D 場`, keywords: [] },
    });
    const n2 = await prisma.courseSession.create({
      data: { title: `${TAG} E 場`, keywords: [] },
    });
    check("沒設碼的場次可以並存", !!n1.id && !!n2.id);

    console.log("\n會議連結組裝");
    check(
      "有密碼且連結沒帶 pwd → 自動附加",
      buildJoinUrl("https://us02web.zoom.us/j/123", "abc").includes("pwd=abc"),
    );
    check(
      "連結已含 pwd → 原樣不動",
      buildJoinUrl("https://us02web.zoom.us/j/123?pwd=xyz", "abc") ===
        "https://us02web.zoom.us/j/123?pwd=xyz",
    );
    check("沒密碼 → 原樣不動", buildJoinUrl("https://a.b/c") === "https://a.b/c");
    check("javascript: 被判為不安全", !isSafeHttpUrl("javascript:alert(1)"));
    check("data: 被判為不安全", !isSafeHttpUrl("data:text/html,<script>"));
    check("https 合法", isSafeHttpUrl("https://us02web.zoom.us/j/123"));
  } finally {
    await prisma.courseSession.deleteMany({ where: { title: { startsWith: TAG } } });
  }

  console.log(`\n通過 ${pass}、失敗 ${fail}`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
