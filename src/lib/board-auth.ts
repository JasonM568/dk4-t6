import "server-only";

import { createHash } from "crypto";
import { cookies } from "next/headers";
import { prisma } from "@/lib/db";

// 看板 4 位碼閘門：cookie 值 = `${exp}.${sha256(code:exp:salt)}`，
// 伺服器端驗到期時間與簽章——改碼或逾時即失效，保留 cookie 也無法重用。
// 門檻刻意輕量（合作方免帳號查看），看板只露姓名不露聯絡資料。

export const BOARD_COOKIE = "board_auth";
const salt = () => process.env.UNSUBSCRIBE_SECRET ?? "course-board-salt";

export function signBoardToken(code: string, expMs: number): string {
  const hash = createHash("sha256").update(`${code}:${expMs}:${salt()}`).digest("hex");
  return `${expMs}.${hash}`;
}

export async function getBoardCode(): Promise<string | null> {
  const row = await prisma.siteSetting.findUnique({ where: { key: "boardCode" } });
  return row?.value ?? null;
}

/** 看板登入時效（小時），後台設定；預設 24，限 1–720 */
export async function getBoardSessionHours(): Promise<number> {
  const row = await prisma.siteSetting.findUnique({
    where: { key: "boardSessionHours" },
  });
  const n = Number(row?.value);
  if (!Number.isFinite(n)) return 24;
  return Math.min(720, Math.max(1, Math.round(n)));
}

/** 看板驗證狀態：expiresAt 有值 = 已通過且未逾時 */
export async function boardAuthStatus(): Promise<{ expiresAt: Date | null }> {
  const code = await getBoardCode();
  if (!code) return { expiresAt: null }; // 未設定登入碼 = 看板關閉
  const jar = await cookies();
  const raw = jar.get(BOARD_COOKIE)?.value;
  if (!raw) return { expiresAt: null };
  const dot = raw.indexOf(".");
  if (dot <= 0) return { expiresAt: null };
  const expMs = Number(raw.slice(0, dot));
  if (!Number.isFinite(expMs) || expMs <= Date.now()) return { expiresAt: null };
  if (raw !== signBoardToken(code, expMs)) return { expiresAt: null };
  return { expiresAt: new Date(expMs) };
}
