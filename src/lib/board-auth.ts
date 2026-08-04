import "server-only";

import { createHash } from "crypto";
import { cookies } from "next/headers";
import { prisma } from "@/lib/db";

// 看板 4 位碼閘門：cookie 存 sha256(code + salt)，改碼即全面失效。
// 門檻刻意輕量（合作方免帳號查看），看板只露姓名不露聯絡資料。

export const BOARD_COOKIE = "board_auth";
const salt = () => process.env.UNSUBSCRIBE_SECRET ?? "course-board-salt";

export function hashBoardCode(code: string): string {
  return createHash("sha256").update(`${code}:${salt()}`).digest("hex");
}

export async function getBoardCode(): Promise<string | null> {
  const row = await prisma.siteSetting.findUnique({ where: { key: "boardCode" } });
  return row?.value ?? null;
}

/** 看板是否已通過 4 位碼驗證（cookie 與目前設定的碼相符） */
export async function isBoardAuthed(): Promise<boolean> {
  const code = await getBoardCode();
  if (!code) return false; // 未設定登入碼 = 看板關閉
  const jar = await cookies();
  return jar.get(BOARD_COOKIE)?.value === hashBoardCode(code);
}
