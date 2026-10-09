import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getAuthUser } from "@/lib/supabase/server";
import { getStaffRole } from "@/lib/auth/staff";
import { canAccessAdmin } from "@/lib/auth/role";
import { canWatchCourse } from "@/lib/course-access";
import { COURSE_MATERIALS_BUCKET, createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

const noStore = { "Cache-Control": "no-store" };

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getAuthUser();
  if (!user) {
    return NextResponse.redirect(new URL("/login", request.url), { status: 302, headers: noStore });
  }

  const { id } = await params;
  if (!/^[A-Za-z0-9_-]{1,40}$/.test(id)) return new Response(null, { status: 404, headers: noStore });
  const material = await prisma.courseMaterial.findUnique({
    where: { id },
    include: { course: true },
  });
  if (!material) return new Response(null, { status: 404, headers: noStore });

  const allowed = await canWatchCourse(material.course, { id: user.id, email: user.email });
  if (!allowed && !canAccessAdmin(await getStaffRole(user.id))) {
    return new Response(null, { status: 404, headers: noStore });
  }

  if (material.storagePath) {
    const { data, error } = await createAdminClient().storage
      .from(COURSE_MATERIALS_BUCKET)
      .createSignedUrl(material.storagePath, 60);
    if (error || !data?.signedUrl) {
      console.error("[materials] 簽名講義網址失敗", { materialId: id, error });
      return new Response(null, { status: 502, headers: noStore });
    }
    return NextResponse.redirect(data.signedUrl, { status: 302, headers: noStore });
  }

  if (material.url && /^https?:\/\//i.test(material.url)) {
    return NextResponse.redirect(material.url, { status: 302, headers: noStore });
  }
  return new Response(null, { status: 404, headers: noStore });
}
