import Link from "next/link";
import { pageGuardEditor } from "@/lib/auth/staff";
import { prisma } from "@/lib/db";
import { createMailGroupAction } from "@/actions/admin";
import { SubmitButton } from "@/components/admin/submit-button";

export const metadata = { title: "名單群組 — 管理後台" };

export default async function MailGroupsPage() {
  await pageGuardEditor();
  const groups = await prisma.mailGroup.findMany({
    include: { _count: { select: { members: true } } },
    orderBy: { createdAt: "desc" },
  });

  return (
    <div className="max-w-3xl">
      <div className="mb-1 flex items-center justify-between">
        <h1 className="text-2xl font-bold">名單群組</h1>
        <Link
          href="/admin/broadcast"
          className="text-sm text-indigo-600 hover:underline"
        >
          ← 回 Email群發
        </Link>
      </div>
      <p className="mb-6 text-sm text-gray-500">
        建立常用的收件名單群組（不限會員），群發 EDM 時可直接選擇群組寄送。
      </p>

      <ul className="mb-8 divide-y divide-gray-100 rounded-xl border border-gray-200">
        {groups.length === 0 && (
          <li className="px-4 py-4 text-sm text-gray-400">
            尚無群組，先在下方建立
          </li>
        )}
        {groups.map((g) => (
          <li key={g.id} className="flex items-center gap-3 px-4 py-3">
            <div className="flex-1">
              <Link
                href={`/admin/broadcast/groups/${g.id}`}
                className="font-medium hover:underline"
              >
                {g.name}
              </Link>
              <span className="ml-2 text-xs text-gray-400">
                {g._count.members} 筆名單
              </span>
            </div>
            <span className="text-xs text-gray-400">
              {g.createdAt.toLocaleDateString("zh-TW", {
                timeZone: "Asia/Taipei",
              })}
            </span>
            <Link
              href={`/admin/broadcast/groups/${g.id}`}
              className="text-sm text-indigo-600 hover:underline"
            >
              管理
            </Link>
          </li>
        ))}
      </ul>

      <form
        action={createMailGroupAction}
        className="space-y-3 rounded-xl border border-dashed border-gray-300 p-4"
      >
        <div className="font-medium">＋ 建立新群組</div>
        <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700">
          名單群組只是「寄信用的 email 清單」，<strong>不會建立會員帳號、也不會開通課程</strong>。
          若你要新增學員並<strong>開通課程觀看權限</strong>，請改用「
          <Link href="/admin/enrollments" className="font-medium underline">
            批次開通
          </Link>
          」（在那裡也能順便建立／加入這個寄信群組）。
        </p>
        <div>
          <label className="mb-1 block text-xs text-gray-500">群組名稱</label>
          <input
            name="name"
            required
            placeholder="例：2026 台北實體班"
            className="w-72 rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-black focus:outline-none"
          />
        </div>
        <div>
          <div className="mb-1 flex items-center justify-between">
            <label className="block text-xs text-gray-500">
              名單（選填，一行一筆，可「email,姓名」格式；之後也能再加）
            </label>
            <a
              href="/templates/mail-list-template.csv"
              download="名單匯入範本.csv"
              className="text-xs text-indigo-600 hover:underline"
            >
              ⬇ 下載 CSV 範本
            </a>
          </div>
          <textarea
            name="list"
            rows={5}
            placeholder={"student1@example.com,王小明\nstudent2@example.com"}
            className="w-full rounded-lg border border-gray-300 px-3 py-2 font-mono text-sm focus:border-black focus:outline-none"
          />
          <div className="mt-2 flex items-center gap-2 text-sm">
            <span className="text-gray-500">或上傳 CSV：</span>
            <input
              type="file"
              name="csv"
              accept=".csv,text/csv"
              className="text-sm file:mr-2 file:rounded-lg file:border-0 file:bg-gray-100 file:px-3 file:py-1.5 file:text-sm file:font-medium hover:file:bg-gray-200"
            />
          </div>
        </div>
        <SubmitButton
          pendingText="建立中，請勿關閉頁面…"
          className="rounded-lg bg-black px-4 py-2 text-sm font-medium text-white transition hover:bg-gray-800"
        >
          建立群組
        </SubmitButton>
        <p className="text-xs text-gray-400">
          建立完成後會自動跳轉到群組頁面
        </p>
      </form>
    </div>
  );
}
