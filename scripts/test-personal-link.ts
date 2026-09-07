/* 專屬連結 {link} 變數（純離線，不碰資料庫、不寄信、不發簡訊）：
 *   npx tsx scripts/test-personal-link.ts
 *
 * 這批測試守的是三件會直接把信寄壞／把錢多花掉的事：
 *   ① /i/<token> 只轉去寫死的邀請站，任何形狀的 token 都不能變成 open redirect
 *   ② {link} 在 Email 與簡訊兩邊的替換一致，且替換後仍走同一條渲染／計費路徑
 *   ③ 簡訊則數必須用「替換後」的長度算——網址 40+ 字，用變數本身的 6 個字算會少一整段
 */
import { GET as inviteRedirect } from "../src/app/i/[token]/route";
import { applyMergeTags, buildContentHtml } from "../src/lib/email/render-content";
import { inspectBroadcastDraft } from "../src/lib/email/preflight";
import {
  applySmsMergeTags,
  composeSmsText,
  countSms,
  OPTOUT_URL_PLACEHOLDER,
} from "../src/lib/sms/message";

let pass = 0;
const fails: string[] = [];
function check(name: string, cond: boolean, detail?: string) {
  if (cond) pass++;
  else fails.push(`${name}${detail ? ` — ${detail}` : ""}`);
}
function eq(name: string, got: unknown, want: unknown) {
  check(name, Object.is(got, want), `got ${JSON.stringify(got)} want ${JSON.stringify(want)}`);
}

const INVITE_HOST = "invite-tjs-projects-435187fd.vercel.app";

async function redirectTarget(token: string): Promise<string> {
  const req = new Request(`https://course.huangxi.info/i/${token}`);
  const res = await inviteRedirect(req as never, {
    params: Promise.resolve({ token }),
  });
  return res.headers.get("location") ?? "";
}

async function main() {
  // ── ① 轉址路由 ──
  eq(
    "正常 token 轉去邀請站",
    await redirectTarget("-0oW5xg59P-g"),
    `https://${INVITE_HOST}/index-s2.html?t=-0oW5xg59P-g`,
  );
  eq("302 而非 301（日後換網域才改得掉）",
    (await inviteRedirect(new Request("https://course.huangxi.info/i/abc123") as never, {
      params: Promise.resolve({ token: "abc123" }),
    })).status,
    302);

  // open redirect：任何能拼出「別的主機」的字元都必須被擋在字集外。
  // 這些 token 全部只能回首頁，不能出現在 Location 的主機位置。
  const attacks = [
    "..%2f..%2fevil.com",
    "../../evil.com",
    "evil.com/x",
    "//evil.com",
    "a.evil.com",
    "http://evil.com",
    "abc:123",
    "abc?x=1",
    "abc#frag",
    "abc def",
    "短",           // 太短
    "",             // 空
    "@evil.com",
    "\\\\evil.com",
  ];
  for (const t of attacks) {
    const loc = await redirectTarget(t);
    const host = (() => {
      try {
        return new URL(loc, "https://course.huangxi.info").host;
      } catch {
        return "(unparsable)";
      }
    })();
    check(
      `open redirect 擋下：${JSON.stringify(t)}`,
      host === "course.huangxi.info",
      `Location=${loc}`,
    );
  }
  // 合法字集的邊界：底線與連字號要放行（base64url），長度上下界要準
  eq("6 碼放行", await redirectTarget("abcdef"), `https://${INVITE_HOST}/index-s2.html?t=abcdef`);
  eq("5 碼擋下", await redirectTarget("abcde"), "https://course.huangxi.info/");
  eq(
    "底線與連字號放行",
    await redirectTarget("a_b-c_d-e1"),
    `https://${INVITE_HOST}/index-s2.html?t=a_b-c_d-e1`,
  );
  eq("65 碼擋下", await redirectTarget("a".repeat(65)), "https://course.huangxi.info/");

  // ── ② Email 的 {link} ──
  const LINK = "https://course.huangxi.info/i/-0oW5xg59P-g";
  const body = "婉箖你好，\n\n這是你的專屬聆聽連結（請勿轉發）：\n{link}\n\n聽完再聊。";
  const merged = applyMergeTags(body, { email: "a@b.com", name: "婉箖", link: LINK });
  check("Email {link} 有替換", merged.includes(LINK) && !merged.includes("{link}"));
  eq(
    "沒給 link 時替換成空字串（不留變數原文寄出去）",
    applyMergeTags("看這裡：{link}", { email: "a@b.com" }),
    "看這裡：",
  );
  const html = buildContentHtml(merged);
  check(
    "替換後的網址仍變成真 <a>（Resend 才追蹤得到誰點了）",
    html.includes(`<a href="${LINK}"`),
    html.slice(0, 200),
  );
  check("內文沒有殘留未替換的變數", !html.includes("{link}"));

  // 注入：連結欄位是操作者從 Excel 貼進來的，不是可信輸入
  const evil = applyMergeTags("{link}", {
    email: "a@b.com",
    link: '"><script>alert(1)</script>',
  });
  const evilHtml = buildContentHtml(evil);
  check(
    "連結欄位含 HTML 也會被轉義（替換在 esc 之前，順序不可調換）",
    !evilHtml.includes("<script>"),
    evilHtml,
  );

  // preflight：{link} 要被當成已知變數，也要算 CTA
  const pf = inspectBroadcastDraft({ subject: "測試", body });
  check("preflight 不再把 {link} 當未支援變數", pf.errors.length === 0, pf.errors.join("／"));
  check(
    "只有 {link} 沒有明文網址時，不再誤報「沒有 CTA」",
    !pf.warnings.some((w) => w.includes("CTA")),
    pf.warnings.join("／"),
  );

  // ── ③ 簡訊的 {link} 與則數 ──
  const smsBody = "{name}你好，我是顧院長。我錄了一段話給你，兩分鐘：\n{link}";
  const smsMerged = applySmsMergeTags(smsBody, { mobile: "0912345678", name: "婉箖", link: LINK });
  check("簡訊 {link} 有替換", smsMerged.includes(LINK) && !smsMerged.includes("{link}"));
  eq(
    "簡訊沒給 link 時替換成空字串",
    applySmsMergeTags("看：{link}", { mobile: "0912345678" }),
    "看：",
  );

  // 這一項是整批測試的重點：用變數原文算則數 vs 用替換後算則數，
  // 差的是真金白銀。若哪天有人把逐人渲染改成整批共用一份文字，這裡會紅。
  const compose = (t: string) =>
    composeSmsText(t, {
      messageType: "MARKETING",
      brandPrefix: "【希望學院】",
      optOutUrl: OPTOUT_URL_PLACEHOLDER,
    });
  const LONG = `https://${INVITE_HOST}/index-s2.html?t=-0oW5xg59P-g`;
  const segRaw = countSms(compose(smsBody)).segments;
  const segMergedLong = countSms(
    compose(applySmsMergeTags(smsBody, { mobile: "0912345678", name: "婉箖", link: LONG })),
  ).segments;
  check(
    "用變數原文估則數會低估（證明必須逐人替換後再算）",
    segRaw < segMergedLong,
    `原文 ${segRaw} 則 / 替換後 ${segMergedLong} 則`,
  );

  // 短連結的實際效益：42 字 vs 76 字，在這封信上就是一整則的差別
  const segShort = countSms(
    compose(applySmsMergeTags(smsBody, { mobile: "0912345678", name: "婉箖", link: LINK })),
  ).segments;
  const segLong = countSms(
    compose(applySmsMergeTags(smsBody, { mobile: "0912345678", name: "婉箖", link: LONG })),
  ).segments;
  check(
    "短連結比原邀請站網址少一則",
    segShort < segLong,
    `短 ${segShort} 則（${LINK.length} 字）/ 長 ${segLong} 則（${LONG.length} 字）`,
  );

  console.log(`\n通過 ${pass} 項${fails.length ? `，失敗 ${fails.length} 項` : "，全數通過"}`);
  for (const f of fails) console.log("  ✗ " + f);
  if (fails.length) process.exit(1);
}

main();
