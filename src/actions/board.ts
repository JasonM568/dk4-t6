"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { BOARD_COOKIE, getBoardCode, hashBoardCode } from "@/lib/board-auth";

export type BoardLoginState = { error?: string } | null;

/** 看板 4 位碼登入：對碼成功 → 設 httpOnly cookie（30 天） */
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

  const jar = await cookies();
  jar.set(BOARD_COOKIE, hashBoardCode(code), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });
  revalidatePath("/board");
  return null;
}
