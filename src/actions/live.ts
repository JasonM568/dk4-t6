"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import {
  LIVE_COOKIE,
  clearLiveLoginFails,
  getLiveClientIp,
  liveCodeEquals,
  liveLoginBlocked,
  recordLiveLoginFail,
  signLiveToken,
} from "@/lib/live-auth";
import { hasEndedInTaipei } from "@/lib/board-expiry";

export type LiveLoginState = { error?: string } | null;

/** 失敗固定延遲＋抖動：緩暴力嘗試，也拉平「查得到/ 查不到」的時序差異 */
async function failDelay(): Promise<void> {
  await new Promise((r) => setTimeout(r, 1000 + Math.floor(Math.random() * 250)));
}

/** 學員憑 4 位查看碼進入線上上課資訊頁：
 *  格式驗證 → 共享限流 → 查場次 → 恆定時間對碼 → 簽章 cookie（綁該場次）。
 *
 *  錯誤訊息一律含糊（「查看碼錯誤」），不區分「沒這組碼」「這場還沒設連結」
 *  「這場已結束」——區分了就是一個可以拿來枚舉場次狀態的探針。 */
export async function liveLoginAction(
  _prev: LiveLoginState,
  formData: FormData,
): Promise<LiveLoginState> {
  const input = String(formData.get("code") ?? "").trim();
  if (!/^\d{4}$/.test(input)) {
    await failDelay();
    return { error: "查看碼須為 4 位數字" };
  }

  const ip = await getLiveClientIp();
  if (await liveLoginBlocked(ip)) {
    await failDelay();
    return { error: "嘗試次數過多，請 15 分鐘後再試" };
  }

  const session = await prisma.courseSession.findUnique({
    where: { accessCode: input },
    select: {
      id: true,
      accessCode: true,
      meetingUrl: true,
      eventDate: true,
      endDate: true,
    },
  });

  // 沒這組碼／這場沒設連結／已經結束 → 一律同一句話、同一個延遲
  const usable =
    session &&
    session.accessCode &&
    liveCodeEquals(input, session.accessCode) &&
    !!session.meetingUrl &&
    !hasEndedInTaipei(session.endDate ?? session.eventDate);

  if (!usable) {
    await recordLiveLoginFail(ip);
    await failDelay();
    return { error: "查看碼錯誤，或這堂課尚未開放／已結束" };
  }

  await clearLiveLoginFails(ip);
  const signed = signLiveToken(session.id, session.accessCode!);
  if (!signed) {
    // BOARD_SESSION_SECRET 缺漏：安全失敗，不退回任何公開字串簽章
    return { error: "本頁暫時無法使用，請聯繫客服" };
  }

  const jar = await cookies();
  jar.set(LIVE_COOKIE, signed.token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: Math.floor((signed.expMs - Date.now()) / 1000),
  });
  revalidatePath("/live");
  return null;
}

/** 換一堂課／自行登出 */
export async function liveLogoutAction() {
  const jar = await cookies();
  jar.delete(LIVE_COOKIE);
  revalidatePath("/live");
}
