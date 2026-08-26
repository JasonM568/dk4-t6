import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { hasEndedInTaipei } from "@/lib/board-expiry";
import {
  LIVE_COOKIE,
  clearLiveLoginFails,
  getLiveClientIp,
  liveCodeEquals,
  liveLoginBlocked,
  recordLiveLoginFail,
  signLiveToken,
} from "@/lib/live-auth";

// 簡訊／通知信裡的一鍵連結：course.huangxi.info/live/8241
// 驗完碼就把 cookie 種下並轉去 /live，網址列只會留下 /live——
// 碼不會留在瀏覽器歷史、也不會出現在之後的分享畫面上。
//
// 為什麼是 route handler 而不是頁面：只有 route handler 與 server action
// 能寫 cookie，RSC 渲染中不行。做成頁面就得把碼一直掛在網址上。
//
// 這條路徑與表單走「完全相同」的驗證與限流——否則它就是一個沒鎖的後門，
// 4 位碼只有一萬組，沒有限流的 GET 端點幾分鐘就被掃完。
export const dynamic = "force-dynamic";

/** 失敗固定延遲＋抖動：與 liveLoginAction 同一套，拉平時序差異 */
async function failDelay(): Promise<void> {
  await new Promise((r) => setTimeout(r, 1000 + Math.floor(Math.random() * 250)));
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ code: string }> },
) {
  const { code } = await params;
  const fail = (reason: "bad" | "locked") =>
    NextResponse.redirect(new URL(`/live?e=${reason}`, request.url));

  // 形狀不對就不必打 DB，也不記失敗（爬蟲亂試路徑不該把學員的 IP 鎖掉）
  if (!/^\d{4}$/.test(code)) {
    return NextResponse.redirect(new URL("/live", request.url));
  }

  const ip = await getLiveClientIp();
  if (await liveLoginBlocked(ip)) {
    await failDelay();
    return fail("locked");
  }

  const session = await prisma.courseSession.findUnique({
    where: { accessCode: code },
    select: {
      id: true,
      accessCode: true,
      meetingUrl: true,
      eventDate: true,
      endDate: true,
    },
  });

  const usable =
    session &&
    session.accessCode &&
    liveCodeEquals(code, session.accessCode) &&
    !!session.meetingUrl &&
    !hasEndedInTaipei(session.endDate ?? session.eventDate);

  if (!usable) {
    await recordLiveLoginFail(ip);
    await failDelay();
    return fail("bad");
  }

  await clearLiveLoginFails(ip);
  const signed = signLiveToken(session.id, session.accessCode!);
  if (!signed) return fail("bad"); // secret 缺漏：安全失敗，不簽任何東西

  const res = NextResponse.redirect(new URL("/live", request.url));
  res.cookies.set(LIVE_COOKIE, signed.token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: Math.floor((signed.expMs - Date.now()) / 1000),
  });
  return res;
}
