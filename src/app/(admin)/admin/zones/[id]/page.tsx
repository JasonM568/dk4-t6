import Link from "next/link";
import { notFound } from "next/navigation";
import { pageGuardEditor } from "@/lib/auth/staff";
import { prisma } from "@/lib/db";
import {
  addZoneMemberAction,
  importZoneMembersAction,
  removeZoneMember,
  updateZoneAction,
  createZoneInviteAction,
  toggleZoneInvite,
  deleteZoneAction,
} from "@/actions/admin";
import {
  AddZoneMemberForm,
  ImportZoneMembersForm,
  CopyInviteLink,
  ColorField,
} from "./zone-member-forms";

export const metadata = { title: "專區管理 — 管理後台" };

const SOURCE_LABEL: Record<string, string> = {
  MANUAL: "手動新增",
  IMPORT: "批次匯入",
  INVITE: "邀請碼註冊",
};

export default async function AdminZoneDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await pageGuardEditor();
  const { id } = await params;
  const zone = await prisma.courseGroup.findUnique({
    where: { id },
    include: {
      members: { orderBy: { createdAt: "desc" } },
      inviteCodes: { orderBy: { createdAt: "desc" } },
      courses: {
        orderBy: [{ sortOrder: "asc" }, { createdAt: "desc" }],
        select: { id: true, title: true, isPublished: true },
      },
    },
  });
  if (!zone) notFound();

  const base = process.env.NEXT_PUBLIC_BASE_URL ?? "http://localhost:3000";

  return (
    <div className="max-w-3xl">
      <div className="mb-1 flex items-center justify-between">
        <h1 className="text-2xl font-bold">{zone.name}</h1>
        <Link href="/admin/zones" className="text-sm text-indigo-600 hover:underline">
          ← 回專區列表
        </Link>
      </div>
      <p className="mb-6 font-mono text-sm text-gray-400">/zone/{zone.slug}</p>

      {/* 基本資料 */}
      <section className="mb-8 rounded-xl border border-gray-200 p-4">
        <h2 className="mb-3 font-bold">基本資料</h2>
        <form action={updateZoneAction.bind(null, zone.id)} className="space-y-3">
          <div>
            <label className="mb-1 block text-xs text-gray-500">專區名稱</label>
            <input
              name="name"
              required
              defaultValue={zone.name}
              className="w-72 rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-black focus:outline-none"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs text-gray-500">
              擋牆說明文字（非會員進入專區時顯示，選填，如聯絡窗口）
            </label>
            <textarea
              name="wallText"
              rows={3}
              defaultValue={zone.wallText ?? ""}
              placeholder="例：本專區為世華會企業包班會員專屬，欲加入請洽世華會祕書處。"
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-black focus:outline-none"
            />
          </div>
          <div className="flex flex-wrap gap-6">
            <ColorField
              name="themePrimary"
              label="主題色（專區標題區/按鈕；空 = 全站預設）"
              defaultValue={zone.themePrimary}
              placeholder="#7c3aed"
            />
            <ColorField
              name="themeAccent"
              label="輔助色（漸層第二色/徽章；空 = 沿用主題色）"
              defaultValue={zone.themeAccent}
              placeholder="#f59e0b"
            />
          </div>
          <button className="rounded-lg bg-black px-4 py-2 text-sm font-medium text-white transition hover:bg-gray-800">
            儲存
          </button>
        </form>
      </section>

      {/* 專區課程 */}
      <section className="mb-8 rounded-xl border border-gray-200 p-4">
        <h2 className="mb-1 font-bold">專區課程（{zone.courses.length}）</h2>
        <p className="mb-3 text-xs text-gray-400">
          到「課程上架」新增/編輯課程時，將「所屬專區」選為此專區即可掛入。
          觀看權限需另外用「批次開通」逐課開通給會員。
        </p>
        <ul className="divide-y divide-gray-100">
          {zone.courses.length === 0 && (
            <li className="py-2 text-sm text-gray-400">尚無課程</li>
          )}
          {zone.courses.map((c) => (
            <li key={c.id} className="flex items-center gap-2 py-2 text-sm">
              <Link
                href={`/admin/courses/${c.id}`}
                className="flex-1 hover:underline"
              >
                {c.title}
              </Link>
              {!c.isPublished && (
                <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-500">
                  未上架
                </span>
              )}
            </li>
          ))}
        </ul>
      </section>

      {/* 邀請碼 */}
      <section className="mb-8 rounded-xl border border-gray-200 p-4">
        <h2 className="mb-1 font-bold">邀請碼（{zone.inviteCodes.length}）</h2>
        <p className="mb-3 text-xs text-gray-400">
          把邀請連結發給對方：新朋友用連結註冊即自動取得會籍；已有帳號者登入後在專區頁輸入邀請碼。
        </p>
        <ul className="mb-4 divide-y divide-gray-100">
          {zone.inviteCodes.map((inv) => (
            <li key={inv.id} className="flex flex-wrap items-center gap-2 py-2 text-sm">
              <span className="font-mono font-medium">{inv.code}</span>
              {inv.label && <span className="text-gray-500">{inv.label}</span>}
              <span className="text-xs text-gray-400">
                已用 {inv.usedCount} 次
                {inv.expiresAt &&
                  ` · ${inv.expiresAt.toLocaleDateString("zh-TW", { timeZone: "Asia/Taipei" })} 到期`}
              </span>
              <span className="flex-1" />
              {inv.isActive ? (
                <CopyInviteLink url={`${base}/register?invite=${inv.code}`} />
              ) : (
                <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-500">
                  已停用
                </span>
              )}
              <form action={toggleZoneInvite.bind(null, inv.id, zone.id, !inv.isActive)}>
                <button className="text-sm text-red-600 hover:underline">
                  {inv.isActive ? "停用" : "重新啟用"}
                </button>
              </form>
            </li>
          ))}
        </ul>
        <form
          action={createZoneInviteAction.bind(null, zone.id)}
          className="flex flex-wrap items-end gap-2 border-t border-dashed border-gray-200 pt-4"
        >
          <div>
            <label className="mb-1 block text-xs text-gray-500">備註（選填）</label>
            <input
              name="label"
              placeholder="例：2026 年會發放"
              className="w-48 rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-black focus:outline-none"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs text-gray-500">有效期限（選填）</label>
            <input
              name="expiresAt"
              type="date"
              className="rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-black focus:outline-none"
            />
          </div>
          <button className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-indigo-700">
            產生邀請碼
          </button>
        </form>
      </section>

      {/* 會員管理 */}
      <section className="mb-8 rounded-xl border border-gray-200 p-4">
        <h2 className="mb-3 font-bold">專區會員（{zone.members.length}）</h2>

        <div className="mb-4 space-y-4">
          <AddZoneMemberForm addAction={addZoneMemberAction.bind(null, zone.id)} />
          <details className="rounded-lg border border-dashed border-gray-300 p-3">
            <summary className="cursor-pointer text-sm font-medium">
              批次匯入名單
            </summary>
            <div className="mt-3">
              <ImportZoneMembersForm
                importAction={importZoneMembersAction.bind(null, zone.id)}
              />
            </div>
          </details>
        </div>

        <ul className="divide-y divide-gray-100 rounded-xl border border-gray-200">
          {zone.members.length === 0 && (
            <li className="px-4 py-3 text-sm text-gray-400">尚無會員</li>
          )}
          {zone.members.map((m) => (
            <li key={m.id} className="flex items-center gap-2 px-4 py-2.5 text-sm">
              <div className="flex-1">
                <span className="font-medium">{m.email}</span>
                {m.name && <span className="ml-2 text-gray-500">{m.name}</span>}
              </div>
              <span className="text-xs text-gray-400">
                {SOURCE_LABEL[m.source] ?? m.source}
              </span>
              <span className="text-xs text-gray-400">
                {m.createdAt.toLocaleDateString("zh-TW", { timeZone: "Asia/Taipei" })}
              </span>
              <form action={removeZoneMember.bind(null, m.id, zone.id)}>
                <button className="text-sm text-red-600 hover:underline">移除</button>
              </form>
            </li>
          ))}
        </ul>
        <p className="mt-2 text-xs text-gray-400">
          移除只影響「能否看到專區」；已開通的課程觀看權限不會被取消（需到課程的觀看名單移除）。
        </p>
      </section>

      {/* 刪除專區 */}
      <section className="rounded-xl border border-red-100 bg-red-50/40 p-4">
        <h2 className="mb-1 font-bold text-red-700">刪除專區</h2>
        <p className="mb-3 text-xs text-gray-500">
          刪除後專區課程會退回一般課程（重新公開販售！）、會員名單與邀請碼一併刪除；已開通的觀看權限不受影響。
        </p>
        <form action={deleteZoneAction.bind(null, zone.id)}>
          <button className="rounded-lg border border-red-300 px-4 py-2 text-sm font-medium text-red-700 transition hover:bg-red-50">
            刪除「{zone.name}」
          </button>
        </form>
      </section>
    </div>
  );
}
