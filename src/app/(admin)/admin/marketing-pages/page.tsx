import { pageGuardEditor } from "@/lib/auth/staff";
import { prisma } from "@/lib/db";
import {
  CreateCustomPageForm,
  CustomPageCard,
} from "../settings/custom-pages-manager";

// 行銷頁（自訂頁 /p/<代稱>）：短影片行銷頁、活動落地頁。
// 2026-08-30 從「系統設定→分頁管理」搬到行銷推播——這是行銷素材，
// 跟站台分頁開關（講師群/知識專區那種結構性分頁）性質不同。
export const metadata = { title: "行銷頁 — 管理後台" };

export default async function MarketingPagesPage() {
  await pageGuardEditor();
  const customPages = await prisma.customPage.findMany({
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
  });

  return (
    <div className="max-w-2xl">
      <h1 className="mb-1 text-2xl font-bold">行銷頁</h1>
      <p className="mb-6 text-sm text-gray-500">
        自建前台頁面（網址 <code className="rounded bg-gray-100 px-1">/p/代稱</code>
        ），可放文字、圖片與影片。
        <br />
        <strong>短影片行銷頁</strong>：填影片網址、關掉「顯示於導覽列」，EDM／簡訊放頁面連結導流——
        看過的人 Pixel 會記成受眾（ViewContent），FB 廣告可直接圈這群人再行銷。
        <br />
        內文語法與 EDM 相同：空行分段、網址自動連結、
        <code className="rounded bg-gray-100 px-1">[按鈕文字](網址)</code> 變紅色按鈕。
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
        {customPages.length === 0 && (
          <p className="rounded-xl border border-dashed border-gray-300 px-4 py-8 text-center text-sm text-gray-400">
            還沒有行銷頁，用下方表單建立第一頁。
          </p>
        )}
      </div>

      <div className="rounded-xl border border-dashed border-gray-300 p-4">
        <h2 className="mb-2 text-sm font-medium">新增頁面</h2>
        <CreateCustomPageForm />
      </div>
    </div>
  );
}
