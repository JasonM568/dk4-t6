import { getPageStates } from "@/lib/site-pages";
import { getTrackingSettings } from "@/lib/tracking";
import { togglePageAction } from "@/actions/admin";
import { pageGuardFullAdmin } from "@/lib/auth/staff";
import { prisma } from "@/lib/db";
import { TrackingForm } from "./tracking-form";
import { CreateCustomPageForm, CustomPageCard } from "./custom-pages-manager";
import Link from "next/link";

export const metadata = { title: "分頁管理 — 管理後台" };

export default async function AdminSettingsPage() {
  await pageGuardFullAdmin(); // 僅管理員
  const [pages, tracking, customPages] = await Promise.all([
    getPageStates(),
    getTrackingSettings(),
    prisma.customPage.findMany({
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    }),
  ]);

  return (
    <div className="max-w-2xl">
      <h1 className="mb-1 text-2xl font-bold">分頁管理</h1>
      <p className="mb-6 text-sm text-gray-500">
        控制首頁頂端導覽分頁的顯示；關閉後該分頁從導覽列消失，直接輸入網址也會顯示 404。
      </p>

      <ul className="divide-y divide-gray-100 rounded-xl border border-gray-200">
        {pages.map((p) => (
          <li key={p.key} className="flex items-center gap-3 px-4 py-3">
            <div className="flex-1">
              <div className="text-sm font-medium">{p.title}</div>
              <div className="text-xs text-gray-400">{p.path}</div>
            </div>
            <span
              className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                p.enabled
                  ? "bg-green-50 text-green-700"
                  : "bg-gray-100 text-gray-500"
              }`}
            >
              {p.enabled ? "開啟中" : "已關閉"}
            </span>
            <form action={togglePageAction.bind(null, p.key, !p.enabled)}>
              <button
                className={`rounded-lg border px-3 py-1.5 text-sm transition ${
                  p.enabled
                    ? "border-gray-300 text-gray-600 hover:bg-gray-50"
                    : "border-green-600 bg-green-600 text-white hover:bg-green-700"
                }`}
              >
                {p.enabled ? "關閉" : "開啟"}
              </button>
            </form>
          </li>
        ))}
      </ul>

      {/* 自訂分頁：後台自建的前台頁面 */}
      <section className="mt-10">
        <h2 className="mb-1 text-lg font-bold">自訂分頁</h2>
        <p className="mb-4 text-sm text-gray-500">
          自建前台頁面（網址 /p/代稱），可放文字、圖片與影片；「顯示於導覽列」開啟後出現在頂端導覽。
          <strong>短影片行銷頁</strong>：填影片網址、關掉「顯示於導覽列」，EDM 放頁面連結導流——看過的人 Pixel 會記成受眾（ViewContent），FB 廣告可直接圈這群人再行銷。
          內文語法與 EDM 相同：空行分段、網址自動連結、[按鈕文字](網址) 變紅色按鈕。
        </p>
        <div className="mb-4 space-y-3">
          {customPages.map((p) => (
            <CustomPageCard
              key={p.id}
              page={{
                id: p.id,
                slug: p.slug,
                title: p.title,
                content: p.content,
                images: p.images,
                videoUrl: p.videoUrl,
                isPublished: p.isPublished,
                showInNav: p.showInNav,
              }}
            />
          ))}
        </div>
        <div className="rounded-xl border border-dashed border-gray-300 p-4">
          <h3 className="mb-2 text-sm font-medium">新增頁面</h3>
          <CreateCustomPageForm />
        </div>
      </section>

      <section className="mt-10 rounded-xl border border-gray-200 p-4">
        <h2 className="text-lg font-bold">知識專欄</h2>
        <p className="mt-1 text-sm text-gray-500">管理顧院長文章：草稿、發布、下架，以及公開／訂閱會員限定閱讀。</p>
        <Link href="/admin/settings/knowledge" className="mt-3 inline-block rounded-lg border border-indigo-300 px-3 py-1.5 text-sm text-indigo-700 hover:bg-indigo-50">管理知識專欄</Link>
      </section>

      {/* 追蹤碼設定 */}
      <section className="mt-10">
        <h2 className="mb-1 text-lg font-bold">追蹤碼設定</h2>
        <p className="mb-4 text-sm text-gray-500">
          填入 ID 即啟用、清空即停用；追蹤碼只在前台載入（/admin 後台一律不載）。
          儲存後全站生效，投放廣告前先在這裡設定好轉換追蹤。
        </p>
        <TrackingForm defaults={tracking} />
        <p className="mt-2 text-xs text-gray-400">
          已內建事件：全站瀏覽（page_view）、註冊完成（sign_up / CompleteRegistration）。
        </p>
      </section>
    </div>
  );
}
