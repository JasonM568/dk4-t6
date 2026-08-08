import "server-only";

import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";

// 會員補充資料（手機＋個資同意）閘門。
// 2026-08-15 起手機為必填：新會員在註冊時填，既有會員登入後由
// (member)/layout.tsx 與 loginAction 強制導到 /complete-profile 補填。

export async function getMemberProfile(userId: string) {
  return prisma.memberProfile.findUnique({ where: { userId } });
}

/** 是否已補齊（有手機「且」有同意紀錄——訂單回填列只有手機、同意為 null，不算補齊）。
 *  查詢失敗 fail-open 視為已補齊——這是合規閘門不是安全邊界，
 *  DB 瞬斷不該把全站會員鎖在門外（對齊 loginAction「導向查詢失敗不擋登入」的既有原則） */
export async function isProfileComplete(userId: string): Promise<boolean> {
  try {
    const row = await prisma.memberProfile.findUnique({
      where: { userId },
      select: { privacyConsentAt: true },
    });
    return !!row?.privacyConsentAt;
  } catch (e) {
    console.error("[member-profile] 補填狀態查詢失敗（fail-open）：", e);
    return true;
  }
}

/** 會員區頁面閘門：未補齊 → 導去補填頁（帶原目的地，補完送回來） */
export async function requireCompleteProfile(
  userId: string,
  nextPath?: string,
): Promise<void> {
  if (await isProfileComplete(userId)) return;
  const next = nextPath && /^\/(?!\/)/.test(nextPath) ? nextPath : "";
  redirect(next ? `/complete-profile?next=${encodeURIComponent(next)}` : "/complete-profile");
}
