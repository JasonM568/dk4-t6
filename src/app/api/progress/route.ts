import { NextResponse } from "next/server";
import { z } from "zod";
import { getAuthUser } from "@/lib/supabase/server";
import { getProfileRole } from "@/lib/supabase/admin";
import { isAdminRole } from "@/lib/auth/role";
import { prisma } from "@/lib/db";

export const runtime = "nodejs";

// 播放頁回報：累積實看秒數（increment）。
// deltaSec 為「自上次回報以來的實看秒數」，單次上限 120 防灌水/異常；
// positionSec 為最後播放位置（續看參考，選填）。
const Body = z.object({
  lessonId: z.string().min(1),
  deltaSec: z.number().int().min(1).max(120),
  positionSec: z.number().int().min(0).max(86_400).optional(),
});

export async function POST(request: Request) {
  const user = await getAuthUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  const parsed = Body.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }
  const { lessonId, deltaSec, positionSec } = parsed.data;

  const lesson = await prisma.lesson.findUnique({
    where: { id: lessonId },
    select: { courseId: true },
  });
  if (!lesson) {
    return NextResponse.json({ error: "lesson not found" }, { status: 404 });
  }

  // 權限閘門：與播放頁一致——須有 Enrollment，或為管理員（免購買可預覽）
  const enrolled = await prisma.enrollment.findUnique({
    where: { userId_courseId: { userId: user.id, courseId: lesson.courseId } },
    select: { id: true },
  });
  if (!enrolled && !isAdminRole(await getProfileRole(user.id))) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  await prisma.lessonProgress.upsert({
    where: { userId_lessonId: { userId: user.id, lessonId } },
    create: {
      userId: user.id,
      lessonId,
      courseId: lesson.courseId,
      watchedSec: deltaSec,
      lastPositionSec: positionSec ?? 0,
    },
    update: {
      watchedSec: { increment: deltaSec },
      ...(positionSec !== undefined ? { lastPositionSec: positionSec } : {}),
    },
  });

  return NextResponse.json({ ok: true });
}
