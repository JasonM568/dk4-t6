import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { listProfiles } from "@/lib/supabase/admin";
import { enrollmentSource, formatDate } from "@/lib/format";
import { createGroupFromCourseAction, deletePendingEnrollmentAction } from "@/actions/admin";
import { currentCanEdit } from "@/lib/auth/staff";
import { SubmitButton } from "@/components/admin/submit-button";
import { CourseMembersManager } from "./members-manager";

export const metadata = { title: "觀看權限名單 — 管理後台" };

export default async function CourseMembersPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const course = await prisma.course.findUnique({
    where: { id },
    select: { id: true, title: true, courseCode: true },
  });
  if (!course) notFound();

  const [enrollments, profiles, canEditNow, mailGroups, pendings] = await Promise.all([
    prisma.enrollment.findMany({
      where: { courseId: id },
      orderBy: { createdAt: "desc" },
    }),
    listProfiles(),
    currentCanEdit(),
    prisma.mailGroup.findMany({
      orderBy: { createdAt: "desc" },
      select: { id: true, name: true },
    }),
    // 待開通存底（批次開通查無會員）：學員註冊當下自動開通
    prisma.pendingEnrollment.findMany({
      where: { courseId: id, claimedAt: null },
      orderBy: { createdAt: "asc" },
    }),
  ]);
  const profById = new Map(profiles.map((p) => [p.id, p]));

  // 來源統計
  const counts = enrollments.reduce<Record<string, number>>((acc, e) => {
    const key = enrollmentSource(e.source, e.orderId).text;
    acc[key] = (acc[key] ?? 0) + 1;
    return acc;
  }, {});

  return (
    <div className="max-w-4xl">
      <Link
        href={`/admin/courses/${id}`}
        className="text-sm text-gray-500 hover:text-black"
      >
        ← 回課程編輯
      </Link>
      <h1 className="mt-2 mb-1 text-2xl font-bold">觀看權限名單</h1>
      <p className="mb-4 text-sm text-gray-500">
        {course.title}
        {course.courseCode ? `（${course.courseCode}）` : ""} — 共{" "}
        <span className="font-bold text-black">{enrollments.length}</span> 位會員可觀看
        {pendings.length > 0 && (
          <>
            ｜<span className="font-bold text-amber-600">{pendings.length}</span>{" "}
            位待註冊（註冊後自動開通）
          </>
        )}
      </p>

      {/* 待註冊名單：批次開通時查無會員的存底。學員用同一 email 註冊（或管理員建帳號）當下自動開通 */}
      {pendings.length > 0 && (
        <details className="mb-4 rounded-xl border border-amber-200 bg-amber-50 p-3">
          <summary className="cursor-pointer text-sm font-medium text-amber-800">
            待註冊自動開通名單（{pendings.length} 位）— 這些 email 尚未註冊，註冊完成當下自動取得觀看權限
          </summary>
          <p className="mt-2 text-xs text-amber-700/80">
            若學員用<strong>別的信箱</strong>註冊就對不上（雙信箱情況），需在會員管理搜姓名後手動開通；
            確認不需要的存底可按「移除」。
          </p>
          <table className="mt-2 w-full text-sm">
            <thead className="text-left text-xs text-amber-700/70">
              <tr>
                <th className="px-2 py-1.5">#</th>
                <th className="px-2 py-1.5">Email</th>
                <th className="px-2 py-1.5">姓名</th>
                <th className="px-2 py-1.5">存底時間</th>
                {canEditNow && <th className="px-2 py-1.5" />}
              </tr>
            </thead>
            <tbody className="divide-y divide-amber-100">
              {pendings.map((p, i) => (
                <tr key={p.id}>
                  <td className="px-2 py-1.5 font-mono text-amber-700/60">{i + 1}</td>
                  <td className="px-2 py-1.5">{p.email}</td>
                  <td className="px-2 py-1.5">{p.name ?? "—"}</td>
                  <td className="px-2 py-1.5 text-amber-700/60">
                    {formatDate(p.createdAt.toISOString())}
                  </td>
                  {canEditNow && (
                    <td className="px-2 py-1.5 text-right">
                      <form action={deletePendingEnrollmentAction.bind(null, course.id, p.id)}>
                        <SubmitButton
                          pendingText="移除中…"
                          className="rounded border border-amber-300 px-2 py-0.5 text-xs text-amber-700 transition hover:bg-amber-100"
                        >
                          移除
                        </SubmitButton>
                      </form>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      )}

      {/* 同步到電子報名單群組（總教練唯讀時隱藏）。
          名單群組是「寄電子報的名單」，跟課程觀看權限是兩回事；
          這裡把目前全部學員同步進寄信群組（已在的略過），供 EDM 群發。 */}
      {enrollments.length > 0 && canEditNow && (
        <form
          action={createGroupFromCourseAction.bind(null, id)}
          className="mb-4 space-y-2 rounded-xl border border-indigo-200 bg-indigo-50 p-3"
        >
          <div className="text-xs font-medium text-indigo-800">
            同步到電子報名單群組（把目前 {enrollments.length} 位學員加入寄信名單，供群發 EDM；已在的會略過）
          </div>
          <div className="flex flex-wrap items-end gap-2">
            {mailGroups.length > 0 && (
              <div>
                <label className="mb-1 block text-xs text-indigo-700">
                  同步到既有群組
                </label>
                <select
                  name="groupId"
                  defaultValue=""
                  className="rounded-lg border border-indigo-300 bg-white px-3 py-1.5 text-sm focus:border-black focus:outline-none"
                >
                  <option value="">— 選既有群組 —</option>
                  {mailGroups.map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.name}
                    </option>
                  ))}
                </select>
              </div>
            )}
            <div>
              <label className="mb-1 block text-xs text-indigo-700">
                或建立新群組
              </label>
              <input
                name="newName"
                placeholder={`預設：${course.title} 觀看名單`}
                className="w-56 rounded-lg border border-indigo-300 bg-white px-3 py-1.5 text-sm focus:border-black focus:outline-none"
              />
            </div>
            <SubmitButton
              pendingText="同步中…"
              className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-indigo-700"
            >
              同步學員到名單群組
            </SubmitButton>
          </div>
          <p className="text-xs text-indigo-600/70">
            選了既有群組就同步進該群組；否則用名稱建新／併入同名群組。
          </p>
        </form>
      )}

      {/* 來源統計 */}
      <div className="mb-4 flex flex-wrap gap-2">
        {Object.entries(counts).map(([label, n]) => (
          <span
            key={label}
            className="rounded-full bg-gray-100 px-3 py-1 text-xs text-gray-600"
          >
            {label}：{n}
          </span>
        ))}
      </div>

      <CourseMembersManager
        courseId={course.id}
        canEdit={canEditNow}
        members={enrollments.map((e) => {
          const p = profById.get(e.userId);
          return {
            userId: e.userId,
            name: p?.display_name ?? null,
            email: p?.email ?? null,
            source: e.source,
            orderId: e.orderId,
            createdAt: e.createdAt.toISOString(),
          };
        })}
      />
    </div>
  );
}
