import { prisma } from "@/lib/db";
import { currentCanEdit } from "@/lib/auth/staff";
import {
  BoardCodeForm,
  CreateSessionForm,
  UploadOrdersForm,
  SessionCard,
} from "./sessions-manager";

export const metadata = { title: "場次看板 — 管理後台" };

export default async function AdminSessionsPage() {
  const [sessions, boardCode, boardHours, canEditNow] = await Promise.all([
    prisma.courseSession.findMany({
      orderBy: [{ sortOrder: "asc" }, { eventDate: "desc" }, { createdAt: "desc" }],
      include: { signups: { orderBy: { orderedAt: "asc" } } },
    }),
    prisma.siteSetting.findUnique({ where: { key: "boardCode" } }),
    prisma.siteSetting.findUnique({ where: { key: "boardSessionHours" } }),
    currentCanEdit(),
  ]);
  const hoursNum = Number(boardHours?.value);
  const currentHours = Number.isFinite(hoursNum)
    ? Math.min(24, Math.max(1, Math.round(hoursNum)))
    : 8;

  const totalSignups = sessions.reduce((n, s) => n + s.signups.length, 0);

  return (
    <div className="max-w-4xl">
      <h1 className="mb-1 text-2xl font-bold">課程場次看板</h1>
      <p className="mb-6 text-sm text-gray-500">
        手動上架場次 → 定期上傳 1shop 訂單檔自動歸類報名 → 看板（/board）憑 4 位碼唯讀查看。
        目前 {sessions.length} 個場次、共 {totalSignups} 筆報名。
      </p>

      {canEditNow && (
        <>
          {/* 看板入口與登入碼 */}
          <section className="mb-4 rounded-xl border border-indigo-200 bg-indigo-50 p-4">
            <div className="mb-2 text-sm font-medium text-indigo-800">
              看板網址：<code className="rounded bg-white px-2 py-0.5">course.huangxi.info/board</code>
              （傳給需要看報名情況的人，輸入登入碼即可查看）
            </div>
            <BoardCodeForm current={boardCode?.value ?? null} currentHours={currentHours} />
          </section>

          {/* 上傳訂單 */}
          <section className="mb-4 rounded-xl border border-dashed border-gray-300 p-4">
            <h2 className="mb-2 text-sm font-medium">上傳訂單檔（1shop 匯出 .xlsx / .csv）</h2>
            <p className="mb-2 text-xs text-gray-400">
              金流狀態「已付款」的訂單依產品關鍵字歸入場次；重複上傳同一檔案不會重複計數；
              訂單狀態「取消」或退款會自動移除既有報名。
            </p>
            <UploadOrdersForm
              sessionOptions={sessions.map((s) => ({ id: s.id, title: s.title }))}
            />
          </section>

          {/* 新增場次 */}
          <section className="mb-6 rounded-xl border border-gray-200 p-4">
            <h2 className="mb-2 text-sm font-medium">新增場次</h2>
            <CreateSessionForm />
          </section>
        </>
      )}

      {/* 場次列表 */}
      <div className="space-y-3">
        {sessions.length === 0 && (
          <p className="rounded-xl border border-gray-200 px-4 py-6 text-center text-sm text-gray-400">
            還沒有場次——先建立場次並設定產品關鍵字，再上傳訂單檔
          </p>
        )}
        {sessions.map((s) => (
          <SessionCard
            key={s.id}
            canEdit={canEditNow}
            session={{
              id: s.id,
              title: s.title,
              eventDate: s.eventDate?.toISOString() ?? null,
              endDate: s.endDate?.toISOString() ?? null,
              keywords: s.keywords,
              isVisible: s.isVisible,
              signups: s.signups.map((g) => ({
                id: g.id,
                orderNo: g.orderNo,
                name: g.name,
                email: g.email,
                phone: g.phone,
                product: g.product,
                orderedAt: g.orderedAt?.toISOString() ?? null,
              })),
            }}
          />
        ))}
      </div>
    </div>
  );
}
