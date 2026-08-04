import "server-only";

import { prisma } from "@/lib/db";

// email 正規化與 course-access.normalizeEmail 同規則（不 import 該模組，
// 避免拉進 staff/headers 依賴鏈，讓本模組可被 tsx 腳本直接測試）
const normalizeEmail = (email: string) => email.trim().toLowerCase();

// 待開通名單：批次開通遇「查無會員」時以 email 存底，
// 帳號出現的當下（學員自行註冊 / 管理員建帳號）自動認領寫入 Enrollment。
// 與專區 autoEnrollOnRegister 同一設計哲學：開通是「狀態」不是一次性動作。
// 所有寫入冪等；認領失敗不應阻斷呼叫端主流程（呼叫端自行 catch）。

/** 批次開通查無會員 → 存底待開通（同課程同 email 冪等，重貼名單不重複） */
export async function recordPendingEnrollment(
  courseId: string,
  row: { email: string; name?: string | null },
  createdBy?: string | null,
): Promise<void> {
  const email = normalizeEmail(row.email);
  await prisma.pendingEnrollment.upsert({
    where: { courseId_email: { courseId, email } },
    // 已存在（含已認領）不動：保留最早的存底時間與認領紀錄
    update: {},
    create: { courseId, email, name: row.name || null, createdBy: createdBy ?? null },
  });
}

/**
 * 帳號出現時呼叫：認領這個 email 全部未認領的待開通 → 建立 Enrollment（source BATCH），
 * 回填 userId 與 claimedAt。回傳實際開通的課程數。
 */
export async function claimPendingEnrollments(
  email: string,
  userId: string,
): Promise<number> {
  const pending = await prisma.pendingEnrollment.findMany({
    where: { email: normalizeEmail(email), claimedAt: null },
    select: { id: true, courseId: true },
  });
  if (pending.length === 0) return 0;

  const res = await prisma.enrollment.createMany({
    data: pending.map((p) => ({ userId, courseId: p.courseId, source: "BATCH" })),
    skipDuplicates: true,
  });
  await prisma.pendingEnrollment.updateMany({
    where: { id: { in: pending.map((p) => p.id) } },
    data: { claimedAt: new Date(), userId },
  });
  return res.count;
}

/** 開通成功（不論來源）時把同課程同 email 的殘留待開通標記已認領，避免名單頁重複顯示 */
export async function markPendingClaimed(
  courseId: string,
  entries: { email: string; userId: string }[],
): Promise<void> {
  if (entries.length === 0) return;
  const byEmail = new Map(entries.map((e) => [normalizeEmail(e.email), e.userId]));
  // 先撈出真的有殘留的（通常 0～少數筆），再逐筆回填 userId
  const stale = await prisma.pendingEnrollment.findMany({
    where: { courseId, claimedAt: null, email: { in: [...byEmail.keys()] } },
    select: { id: true, email: true },
  });
  for (const s of stale) {
    await prisma.pendingEnrollment.update({
      where: { id: s.id },
      data: { claimedAt: new Date(), userId: byEmail.get(s.email) ?? null },
    });
  }
}
