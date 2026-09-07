import { NextResponse, type NextRequest } from "next/server";

// 語音邀請函的短連結：course.huangxi.info/i/<token> → 邀請站的專屬聆聽頁。
//
// 為什麼要這一層轉址，而不是直接把邀請站網址寫進信與簡訊：
//  ① 簡訊計費以字元計，邀請站原網址 76 字、這裡 42 字——每人省一整則
//     （UCS-2 分段 67 字，一則之差就是 1/3 的錢）。
//  ② 更重要的是信任：陌生的 *.vercel.app 網域配一串亂碼，在簡訊裡就是
//     典型的詐騙特徵。收件人認得 course.huangxi.info，退訂連結也在同一個
//     網域，整則簡訊只出現一個 domain。
//
// 目的地是「寫死的常數」，只有 token 從網址帶進來，且限定字集後才拼接——
// 這條路徑不接受任何外部指定的轉址目標，不會變成 open redirect。
export const dynamic = "force-dynamic";

/** 邀請站（獨立的 Vercel 靜態專案，不在本 repo）。改版時只改這裡。 */
const INVITE_BASE = "https://invite-tjs-projects-435187fd.vercel.app/index-s2.html";

/** 邀請站的 token 字集：make_invite_package.py 產的是 12 位 base64url。
 *  放寬到 6–64 位是為了容納之後幾屆可能換的長度，但字集必須鎖死——
 *  一旦放行 `/`、`:`、`.` 就能拼出別的主機，那才是 open redirect。 */
const TOKEN_RE = /^[A-Za-z0-9_-]{6,64}$/;

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;

  // 形狀不對就送回首頁：轉錯的、被截斷的、爬蟲亂試的都走這條，
  // 不回 404 是因為收件人多半是把簡訊網址複製貼上時弄丟了尾巴，
  // 給他一個看得懂的頁面比一片 404 好。
  if (!TOKEN_RE.test(token)) {
    return NextResponse.redirect(new URL("/", request.url));
  }

  // 302（暫時）而非 301：邀請站網域日後若搬家，已經被瀏覽器永久快取的
  // 301 會把舊目的地釘死在收件人的機器上，改不掉。
  return NextResponse.redirect(`${INVITE_BASE}?t=${token}`, 302);
}
