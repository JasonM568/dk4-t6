import Link from "next/link";
import { pageGuardEditor } from "@/lib/auth/staff";
import { prisma } from "@/lib/db";
import { copyMailTemplateAction, deleteMailTemplateManagementAction, saveMailTemplateManagementAction } from "@/actions/mail-templates";
import { ConfirmSubmitButton } from "./template-actions";

export const metadata = { title: "EDM 範本管理" };
const TPE = { timeZone: "Asia/Taipei", hour12: false } as const;

export default async function MailTemplatesPage({ searchParams }: { searchParams: Promise<{ q?: string; edit?: string; ok?: string; error?: string }> }) {
  await pageGuardEditor();
  const params = await searchParams;
  const q = (params.q ?? "").trim().slice(0, 100);
  const [templates, courses, editing] = await Promise.all([
    prisma.mailTemplate.findMany({
      where: q ? { OR: [{ name: { contains: q, mode: "insensitive" } }, { subject: { contains: q, mode: "insensitive" } }] } : {},
      orderBy: { updatedAt: "desc" },
    }),
    prisma.course.findMany({ orderBy: { title: "asc" }, select: { id: true, title: true } }),
    params.edit ? prisma.mailTemplate.findUnique({ where: { id: params.edit } }) : null,
  ]);
  const courseName = new Map(courses.map((course) => [course.id, course.title]));

  return (
    <div className="max-w-6xl">
      <Link href="/admin/broadcast" className="text-sm text-indigo-600 hover:underline">← 回 Email 群發</Link>
      <h1 className="mb-4 mt-1 text-2xl font-bold">EDM 範本管理</h1>
      {params.ok && <p className="mb-3 rounded-lg bg-green-50 px-3 py-2 text-sm text-green-700">✓ {params.ok}</p>}
      {params.error && <p className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{params.error}</p>}
      <div className="grid gap-5 lg:grid-cols-[1fr_380px]">
        <div>
          <form className="mb-3 flex gap-2"><input name="q" defaultValue={q} placeholder="搜尋名稱或主旨" className="w-80 rounded-lg border border-gray-300 px-3 py-2 text-sm" /><button className="rounded-lg bg-black px-4 py-2 text-sm text-white">搜尋</button></form>
          <div className="overflow-hidden rounded-xl border border-gray-200">
            <table className="w-full text-sm"><thead className="bg-gray-50 text-left text-xs text-gray-500"><tr><th className="px-3 py-3">範本／主旨</th><th className="px-3 py-3">關聯課程</th><th className="px-3 py-3">最後更新</th><th className="px-3 py-3">操作</th></tr></thead>
              <tbody className="divide-y divide-gray-100">{templates.length === 0 && <tr><td colSpan={4} className="px-3 py-8 text-center text-gray-400">沒有符合範本</td></tr>}{templates.map((template) => <tr key={template.id}><td className="px-3 py-2.5"><span className="block font-medium">{template.name}</span><span className="block max-w-sm truncate text-xs text-gray-500">{template.subject}</span></td><td className="px-3 py-2.5 text-xs text-gray-500">{template.courseId ? courseName.get(template.courseId) ?? "課程已刪除" : "—"}</td><td className="px-3 py-2.5 text-xs text-gray-400">{template.updatedAt.toLocaleString("zh-TW", TPE)}<span className="block">{template.createdBy ?? ""}</span></td><td className="px-3 py-2.5"><div className="flex flex-wrap gap-1"><Link href={`/admin/broadcast/templates?edit=${template.id}`} className="rounded border px-2 py-1 text-xs">編輯</Link><Link href={`/admin/broadcast?tpl=${template.id}`} className="rounded border px-2 py-1 text-xs">載入</Link><form action={copyMailTemplateAction.bind(null, template.id)}><button className="rounded border px-2 py-1 text-xs">複製</button></form><form action={deleteMailTemplateManagementAction.bind(null, template.id)}><ConfirmSubmitButton label="刪除" message={`確定刪除範本「${template.name}」？歷史寄送不受影響。`} className="rounded border border-red-200 px-2 py-1 text-xs text-red-600" /></form></div></td></tr>)}</tbody>
            </table>
          </div>
        </div>
        <form action={saveMailTemplateManagementAction} className="h-fit space-y-3 rounded-xl border border-gray-200 p-4">
          <h2 className="font-bold">{editing ? `編輯「${editing.name}」` : "新增範本"}</h2>
          <input type="hidden" name="id" value={editing?.id ?? ""} />
          <label className="block text-xs text-gray-600">範本名稱<input required name="name" defaultValue={editing?.name ?? ""} className="mt-1 w-full rounded-lg border px-3 py-2 text-sm" /></label>
          <label className="block text-xs text-gray-600">郵件主旨<input required name="subject" defaultValue={editing?.subject ?? ""} className="mt-1 w-full rounded-lg border px-3 py-2 text-sm" /></label>
          <label className="block text-xs text-gray-600">關聯課程<select name="courseId" defaultValue={editing?.courseId ?? ""} className="mt-1 w-full rounded-lg border px-3 py-2 text-sm"><option value="">不關聯課程</option>{courses.map((course) => <option key={course.id} value={course.id}>{course.title}</option>)}</select></label>
          <label className="block text-xs text-gray-600">內文<textarea required name="body" rows={12} defaultValue={editing?.body ?? ""} className="mt-1 w-full rounded-lg border px-3 py-2 text-sm" /></label>
          <label className="flex items-start gap-2 text-xs text-amber-800"><input type="checkbox" name="overwrite" className="mt-0.5" />若名稱與另一份範本相同，確認以目前內容覆蓋</label>
          <div className="flex gap-2"><button className="rounded-lg bg-indigo-600 px-4 py-2 text-sm text-white">儲存範本</button>{editing && <Link href="/admin/broadcast/templates" className="rounded-lg border px-4 py-2 text-sm">取消</Link>}</div>
        </form>
      </div>
    </div>
  );
}
