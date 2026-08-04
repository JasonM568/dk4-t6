"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import {
  BOARD_COOKIE,
  getBoardCode,
  getBoardSessionHours,
  signBoardToken,
} from "@/lib/board-auth";

export type BoardLoginState = { error?: string } | null;

/** 看板 4 位碼登入：對碼成功 → 設含到期時間戳的簽章 cookie（時效由後台設定） */
export async function boardLoginAction(
  _prev: BoardLoginState,
  formData: FormData,
): Promise<BoardLoginState> {
  const input = String(formData.get("code") ?? "").trim();
  const code = await getBoardCode();

  if (!code) return { error: "看板尚未開放，請聯繫管理員" };
  if (input !== code) {
    // 錯碼固定延遲，緩暴力嘗試（4 位碼門檻本就輕量，僅防無腦掃）
    await new Promise((r) => setTimeout(r, 1000));
    return { error: "登入碼錯誤" };
  }

  const hours = await getBoardSessionHours();
  const expMs = Date.now() + hours * 60 * 60 * 1000;
  const jar = await cookies();
  jar.set(BOARD_COOKIE, signBoardToken(code, expMs), {
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
