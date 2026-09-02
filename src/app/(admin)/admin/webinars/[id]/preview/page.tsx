import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { requireStaff } from "@/lib/auth/staff";
import { buildBroadcastHtml } from "@/lib/email/broadcast";
import { buildWebinarMail, WEBINAR_MAIL_SAMPLE } from "@/lib/webinar-mail";

// 講座索取信預覽：訪客登記後收到的那封信，長什麼樣就顯示什麼樣。
//
// 走的是 buildWebinarMail → buildBroadcastHtml，**與實際寄信完全同一條路徑**
// （src/actions/webinar.ts）。刻意不另寫一份渲染，否則「預覽跟寄出去的不一樣」
// 比沒有預覽更糟。
//
// 動態渲染：講座內容隨時在改，預覽必須是當下存檔的版本。
export const dynamic = "force-dynamic";

export const metadata = { title: "索取信預覽 — 管理後台" };

export default async function WebinarMailPreviewPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireStaff();
  const { id } = await params;
  const webinar = await prisma.webinar.findUnique({ where: { id } });
  if (!webinar) notFound();

  const { subject, body, joinUrl } = buildWebinarMail(webinar, WEBINAR_MAIL_SAMPLE);
  const html = buildBroadcastHtml(body, null);

  return (
    <div className="max-w-4xl">
      <Link href="/admin/webinars" className="text-sm text-indigo-600 hover:underline">
        ← 回講座場次
      </Link>
      <h1 className="mb-1 mt-2 text-2xl font-bold">索取信預覽｜{webinar.title}</h1>
      <p className="mb-5 text-sm text-gray-500">
        訪客在 <code className="rounded bg-gray-100 px-1.5 py-0.5 text-xs">/webinar/{webinar.slug}</code>{" "}
        登記後收到的信。這是<strong>目前存檔的版本</strong>，與實際寄出走同一段組裝程式碼。
        {"{name}"} 以「{WEBINAR_MAIL_SAMPLE.name}」示範帶入。
      </p>

      <dl className="mb-5 space-y-2 rounded-xl border border-gray-200 p-4 text-sm">
        <div className="flex flex-wrap gap-2">
          <dt className="w-24 shrink-0 text-gray-500">寄出主旨</dt>
          <dd className="min-w-0 flex-1 font-medium">{subject}</dd>
        </div>
        <div className="flex flex-wrap gap-2">
          <dt className="w-24 shrink-0 text-gray-500">進會議連結</dt>
          {/* 信裡的 {link} 實際換成什麼：密碼有沒有正確附上 ?pwd= 一眼看得出來 */}
          <dd className="min-w-0 flex-1">
            <a
              href={joinUrl}
              target="_blank"
              rel="noreferrer"
              className="break-all font-mono text-xs text-indigo-600 hover:underline"
            >
              {joinUrl}
            </a>
            {webinar.meetingPassword && !webinar.lectureUrl.includes("pwd=") && (
              <span className="ml-2 rounded bg-green-50 px-1.5 py-0.5 text-xs text-green-700">
                已自動附上密碼
              </span>
            )}
          </dd>
        </div>
        <div className="flex flex-wrap gap-2">
          <dt className="w-24 shrink-0 text-gray-500">名單群組</dt>
          <dd className="min-w-0 flex-1 text-gray-600">
            {webinar.groupId ? "登記後自動加入" : "不加入名單"}
          </dd>
        </div>
      </dl>

      {/* iframe：信件 HTML 是完整文件（含自己的 body 樣式），直接塞進後台頁面會互相污染 */}
      <div className="overflow-hidden rounded-xl border border-gray-200">
        <div className="border-b border-gray-200 bg-gray-50 px-4 py-2 text-xs text-gray-500">
          信件內容（實際渲染）
        </div>
        <iframe
          title="索取信預覽"
          srcDoc={html}
          sandbox=""
          className="h-[70vh] w-full bg-white"
        />
      </div>

      <div className="mt-4 flex flex-wrap gap-2 text-sm">
        <Link
          href={`/webinar/${webinar.slug}`}
          target="_blank"
          className="rounded-lg border border-gray-300 px-3 py-1.5 hover:bg-gray-50"
        >
          🔗 開啟活動頁
        </Link>
        <Link
          href={`/admin/sms?webinar=${webinar.id}`}
          className="rounded-lg border border-indigo-300 px-3 py-1.5 text-indigo-700 hover:bg-indigo-50"
        >
          📱 發提醒簡訊
        </Link>
      </div>
    </div>
  );
}
