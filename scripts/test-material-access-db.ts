/* 講義下載權限整合測試：只可對 localhost DB 執行，Storage 以替身隔離。 */
import { prisma } from "../src/lib/db";
import Module from "node:module";
import { NextRequest } from "next/server";

if (!/@(localhost|127\.0\.0\.1)[:/]/.test(process.env.DATABASE_URL ?? "")) {
  console.error("✗ DATABASE_URL 不是本機資料庫，拒絕執行");
  process.exit(1);
}

type LoadFn = (request: string, ...rest: unknown[]) => unknown;
const M = Module as unknown as { _load: LoadFn };
const originalLoad = M._load;
let currentUser: { id: string; email: string } | null = null;
let staffRole: "coach" | null = null;
let signed: { bucket: string; path: string; seconds: number } | null = null;
M._load = function (this: unknown, request: string, ...rest: unknown[]) {
  if (request === "server-only") return {};
  if (request === "@/lib/supabase/server") return { getAuthUser: async () => currentUser };
  if (request === "@/lib/auth/staff") return {
    getStaffRole: async () => staffRole,
    currentStaffRole: async () => staffRole,
  };
  if (request === "@/lib/supabase/admin") return {
    COURSE_MATERIALS_BUCKET: "course-materials",
    createAdminClient: () => ({ storage: { from: (bucket: string) => ({
      createSignedUrl: async (path: string, seconds: number) => {
        signed = { bucket, path, seconds };
        return { data: { signedUrl: `https://storage.local/signed/${path}` }, error: null };
      },
    }) } }),
  };
  return originalLoad.call(this, request, ...rest);
};

const P = "tmat-";
const ownId = "00000000-0000-4000-8000-00000000a001";
const otherId = "00000000-0000-4000-8000-00000000a002";
const memberId = "00000000-0000-4000-8000-00000000a003";
const users = [ownId, otherId, memberId];
const memberEmail = "material-member@localhost.test";
let pass = 0;
let fail = 0;
function check(name: string, ok: boolean) {
  if (ok) { pass++; console.log(`✓ ${name}`); }
  else { fail++; console.error(`✗ ${name}`); }
}
async function cleanup() {
  await prisma.enrollment.deleteMany({ where: { userId: { in: users } } });
  await prisma.courseGroupMember.deleteMany({ where: { group: { slug: { startsWith: P } } } });
  await prisma.course.deleteMany({ where: { slug: { startsWith: P } } });
  await prisma.courseGroup.deleteMany({ where: { slug: { startsWith: P } } });
}
async function main() {
  const { GET } = await import("../src/app/api/materials/[id]/route");
  await cleanup();
  const group = await prisma.courseGroup.create({ data: { slug: `${P}disabled`, name: "停用測試專區", kind: "SUBSCRIPTION", isActive: false } });
  const base = { description: "測試", price: 100, isPublished: true };
  const course = await prisma.course.create({ data: { ...base, slug: `${P}open`, title: "講義測試" } });
  const disabledCourse = await prisma.course.create({ data: { ...base, slug: `${P}disabled`, title: "停用講義測試", groupId: group.id } });
  const privateMaterial = await prisma.courseMaterial.create({ data: { courseId: course.id, title: "私有 PDF", storagePath: "materials/sample.pdf", url: null } });
  const externalMaterial = await prisma.courseMaterial.create({ data: { courseId: course.id, title: "外部", url: "https://drive.google.com/file/d/example" } });
  const disabledMaterial = await prisma.courseMaterial.create({ data: { courseId: disabledCourse.id, title: "停用專區 PDF", storagePath: "materials/disabled.pdf" } });
  await prisma.enrollment.create({ data: { userId: ownId, courseId: course.id, source: "MANUAL" } });
  await prisma.courseGroupMember.create({ data: { groupId: group.id, email: memberEmail, source: "MANUAL" } });
  const hit = (id: string) => GET(new NextRequest(`http://localhost:3000/api/materials/${id}`), { params: Promise.resolve({ id }) });

  currentUser = null;
  let r = await hit(privateMaterial.id);
  check("未登入導向 /login", r.status === 302 && r.headers.get("location") === "http://localhost:3000/login");
  currentUser = { id: otherId, email: "other@localhost.test" };
  r = await hit(privateMaterial.id);
  check("未開通會員 404", r.status === 404);
  currentUser = { id: ownId, email: "own@localhost.test" };
  r = await hit(privateMaterial.id);
  check("已開通會員取得簽名網址", r.status === 302 && r.headers.get("location") === "https://storage.local/signed/materials/sample.pdf");
  check("簽名指定 course-materials 且限時 60 秒", signed?.bucket === "course-materials" && signed?.path === "materials/sample.pdf" && signed?.seconds === 60);
  check("私有講義回應禁止快取", r.headers.get("cache-control") === "no-store");
  currentUser = { id: otherId, email: "other@localhost.test" };
  staffRole = "coach";
  r = await hit(privateMaterial.id);
  check("後台幹部可取講義", r.status === 302);
  staffRole = null;
  currentUser = { id: ownId, email: "own@localhost.test" };
  r = await hit(externalMaterial.id);
  check("外部網址授權後導向原網址", r.status === 302 && r.headers.get("location") === "https://drive.google.com/file/d/example");
  r = await hit("missing-material-id");
  check("不存在 id 404", r.status === 404);
  currentUser = { id: memberId, email: memberEmail };
  r = await hit(disabledMaterial.id);
  check("停用專區成員無權取講義", r.status === 404);
}
main().catch((e) => { fail++; console.error(e); }).finally(async () => {
  await cleanup().catch((e) => console.error("cleanup failed", e));
  await prisma.$disconnect();
  M._load = originalLoad;
  console.log(`結果：${pass} 通過、${fail} 失敗`);
  process.exitCode = fail ? 1 : 0;
});
