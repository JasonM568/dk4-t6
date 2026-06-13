import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import {
  renameMailGroup,
  deleteMailGroup,
  addGroupMembersAction,
  removeGroupMember,
} from "@/actions/admin";
import { DeleteGroupButton } from "./delete-group-button";
import { SubmitButton } from "@/components/admin/submit-button";

export const metadata = { title: "名單群組 — 管理後台" };

export default async function MailGroupDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const group = await prisma.mailGroup.findUnique({
    where: { id },
    include: { members: { orderBy: { createdAt: "asc" } } },
  });
  if (!group) notFound();

  return (
    <div className="max-w-3xl">
      <Link
        href="/admin/broadcast/groups"
        className="text-sm text-gray-500 hover:text-black"
      >
        ← 名單群組
      </Link>

      <div className="mt-2 mb-6 flex items-center gap-3">
        <form action={renameMailGroup.bind(null, group.id)} className="flex gap-2">
          <input
            name="name"
            required
            defaultValue={group.name}
            className="rounded-lg border border-gray-300 px-3 py-2 text-lg font-bold focus:border-black focus:outline-none"
          />
          <SubmitButton
            pendingText="儲存中…"
            className="text-sm text-indigo-600 hover:underline"
          >
            改名
          </SubmitButton>
        </form>
        <span className="text-sm text-gray-400">
          {group.members.length} 筆名單
        </span>
        <div className="ml-auto">
          <DeleteGroupButton
            groupName={group.name}
            memberCount={group.members.length}
            deleteAction={deleteMailGroup.bind(null, group.id)}
          />
        </div>
      </div>

      {/* 加名單 */}
      <form
        action={addGroupMembersAction.bind(null, group.id)}
        className="mb-6 space-y-2 rounded-xl border border-dashed border-gray-300 p-4"
      >
        <label className="block text-sm font-medium">
          加入名單（一行一筆，可「email,姓名」格式；重複的 email 自動略過）
        </label>
        <textarea
          name="list"
          rows={4}
          required
          placeholder={"student1@example.com,王小明\nstudent2@example.com"}
          className="w-full rounded-lg border border-gray-300 px-3 py-2 font-mono text-sm focus:border-black focus:outline-none"
        />
        <SubmitButton
          pendingText="名單加入中，請勿關閉頁面…"
          className="rounded-lg bg-black px-4 py-2 text-sm font-medium text-white transition hover:bg-gray-800"
        >
          加入名單
        </SubmitButton>
      </form>

      {/* 名單列表 */}
      <div className="overflow-hidden rounded-xl border border-gray-200">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-left text-gray-500">
            <tr>
              <th className="px-4 py-3">#</th>
              <th className="px-4 py-3">Email</th>
              <th className="px-4 py-3">姓名</th>
              <th className="px-4 py-3">加入時間</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {group.members.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-4 text-gray-400">
                  尚無名單，在上方貼入
                </td>
              </tr>
            )}
            {group.members.map((m, i) => (
              <tr key={m.id}>
                <td className="px-4 py-2 font-mono text-gray-400">{i + 1}</td>
                <td className="px-4 py-2">{m.email}</td>
                <td className="px-4 py-2">{m.name ?? "—"}</td>
                <td className="px-4 py-2 text-gray-400">
                  {m.createdAt.toLocaleDateString("zh-TW", {
                    timeZone: "Asia/Taipei",
                  })}
                </td>
                <td className="px-4 py-2 text-right">
                  <form action={removeGroupMember.bind(null, m.id, group.id)}>
                    <SubmitButton
                      pendingText="移除中…"
                      className="text-sm text-red-600 hover:underline"
                    >
                      移除
                    </SubmitButton>
                  </form>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
