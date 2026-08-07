"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import {
  BOARD_COOKIE,
  boardCodeEquals,
  boardLoginBlocked,
  clearBoardLoginFails,
  getBoardClientIp,
  getBoardCode,
  getBoardSessionHours,
  recordBoardLoginFail,
  signBoardToken,
} from "@/lib/board-auth";

export type BoardLoginState = { error?: string } | null;

/** 失敗固定延遲＋抖動：緩暴力嘗試，也拉平正確/錯誤碼的時序差異 */
async function failDelay(): Promise<void> {
  await new Promise((r) => setTimeout(r, 1000 + Math.floor(Math.random() * 250)));
}

/** 看板 4 位碼登入：格式驗證 → 共享限流 → 恆定時間對碼 → 簽章 cookie */
export async function boardLoginAction(
  _prev: BoardLoginState,
  formData: FormData,
): Promise<BoardLoginState> {
  const input = String(formData.get("code") ?? "").trim();
  if (!/^\d{4}$/.test(input)) {
    await failDelay();
    return { error: "登入碼須為 4 位數字" };
  }

  const ip = await getBoardClientIp();
  if (await boardLoginBlocked(ip)) {
    await failDelay();
    return { error: "嘗試次數過多，請 15 分鐘後再試" };
  }

  const code = await getBoardCode();
  if (!code) return { error: "看板尚未開放，請聯繫管理員" };

  if (!boardCodeEquals(input, code)) {
    await recordBoardLoginFail(ip);
    await failDelay();
    return { error: "登入碼錯誤" };
  }

  await clearBoardLoginFails(ip);
  const hours = await getBoardSessionHours();
  const expMs = Date.now() + hours * 60 * 60 * 1000;
  const token = signBoardToken(code, expMs);
  if (!token) {
    // BOARD_SESSION_SECRET 缺漏：安全失敗，不退回任何公開字串簽章
    return { error: "看板登入暫時無法使用，請聯繫管理員" };
  }
  const jar = await cookies();
  jar.set(BOARD_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: hours * 60 * 60,
  });
  revalidatePath("/board");
  return null;
}

/** 看板手動登出 */
export async function boardLogoutAction() {
  const jar = await cookies();
  jar.delete(BOARD_COOKIE);
  revalidatePath("/board");
}
