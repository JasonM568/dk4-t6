import { pageGuardEditor } from "@/lib/auth/staff";
import { prisma } from "@/lib/db";
import { StudentImport } from "./student-import";
import { StudentSync } from "./student-sync";

export const dynamic = "force-dynamic";
export const metadata = { title: "學員資料庫 — 管理後台" };

export default async function Students({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  await pageGuardEditor();
  const q = (await searchParams).q?.trim() ?? "";
  // 電話輸入常帶分隔符（0912-345-678、09 1234 5678）：純數字/符號的查詢
  // 先清成數字再比對，記錄卡才查得到
  const phoneQ = /^[\d\s()+-]+$/.test(q) ? q.replace(/[^\d+]/g, "") : null;
  const records = await prisma.studentRecord.findMany({
    where: q
      ? phoneQ
        ? { phone: { contains: phoneQ } }
        : {
            OR: [
              { email: { contains: q, mode: "insensitive" } },
              { name: { contains: q } },
              { phone: { contains: q } },
            ],
          }
      : undefined,
    include: { histories: { orderBy: [{ attendedAt: "desc" }, { createdAt: "desc" }] } },
    orderBy: { updatedAt: "desc" },
    take: 100,
  });
  return <div className="max-w-5xl">
    <h1 className="text-2xl font-bold">學員資料庫</h1>
    <p className="mb-5 mt-1 text-sm text-gray-500">學員上課記錄卡：<strong>輸入手機號碼</strong>（或姓名、Email）就能查到這個人過去上過哪些課。<strong>手機是學員的識別鍵</strong>（同號碼＝同一人）——夫妻、親子常共用一個信箱，Email 不能拿來認人。</p>
    <form className="mb-5 flex gap-2" action="/admin/students">
      <input name="q" defaultValue={q} placeholder="輸入手機號碼（可帶 - 或空格）、姓名或 Email" className="w-full max-w-md rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-black focus:outline-none" />
      <button className="rounded-lg bg-black px-4 py-2 text-sm font-medium text-white">查詢</button>
      {q && <a href="/admin/students" className="rounded-lg border border-gray-300 px-4 py-2 text-sm">清除</a>}
    </form>
    <StudentImport />
    <StudentSync />
    <section className="mt-6 overflow-hidden rounded-xl border border-gray-200">
      <div className="border-b bg-gray-50 px-4 py-3 text-sm text-gray-500">{q ? `查詢「${q}」：${records.length} 位` : `最近更新的 ${records.length} 位學員`}</div>
      {records.map((record) => <article key={record.id} className="border-b border-gray-100 px-4 py-4 last:border-b-0">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1"><h2 className="font-semibold">{record.name || "未填姓名"}</h2><span className="text-sm text-gray-500">{record.phone || "未填手機"}</span><span className="text-sm text-gray-400">{record.email || "未填 Email"}</span>{record.histories.length > 0 && <span className="rounded bg-indigo-50 px-1.5 py-0.5 text-xs font-medium text-indigo-700">上過 {record.histories.length} 堂</span>}<span className="text-xs text-gray-400">{record.claimedUserId ? "已認領會員帳號" : "尚未註冊"}</span></div>
        {record.histories.length ? <ul className="mt-3 space-y-1 text-sm text-gray-700">{record.histories.map((history) => <li key={history.id}><span className="mr-2 text-gray-400">{history.attendedAt ? history.attendedAt.toLocaleDateString("zh-TW", { year: "numeric", month: "2-digit", timeZone: "Asia/Taipei" }) : "日期未提供"}</span>{history.courseName}{history.note ? <span className="ml-2 text-xs text-gray-400">{history.note}</span> : null}</li>)}</ul> : <p className="mt-2 text-sm text-gray-400">尚無上課紀錄</p>}
      </article>)}
      {!records.length && <p className="p-6 text-center text-sm text-gray-400">查無符合的學員資料。</p>}
    </section>
  </div>;
}
