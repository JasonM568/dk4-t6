import { prisma } from "@/lib/db";
import { currentCanEdit, currentStaffRole } from "@/lib/auth/staff";
import { hasEndedInTaipei } from "@/lib/board-expiry";
import { WebinarBoardSection } from "./webinar-board";
import {
  BoardCodeForm,
  CreateSessionForm,
  UploadOrdersForm,
  SessionCard,
} from "./sessions-manager";

export const metadata = { title: "場次看板 — 管理後台" };

export default async function AdminSessionsPage() {
  const [sessions, allWebinars, boardCode, boardHours, canEditNow, roleNow] = await Promise.all([
    prisma.courseSession.findMany({
      orderBy: [{ sortOrder: "asc" }, { eventDate: "desc" }, { createdAt: "desc" }],
      include: { signups: { orderBy: { orderedAt: "asc" } } },
    }),
    // 講座（唯讀區塊）：與 /board 同一份資料，讓看板一次看完場次＋講座索取狀況
    prisma.webinar.findMany({
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        slug: true,
        title: true,
        isActive: true,
        endDate: true,
        unpublishAt: true,
        requests: {
          orderBy: { createdAt: "asc" },
          select: {
            id: true,
            name: true,
            email: true,
            phone: true,
            deliveryStatus: true,
            deliveryDetail: true,
          },
        },
      },
    }),
    prisma.siteSetting.findUnique({ where: { key: "boardCode" } }),
    prisma.siteSetting.findUnique({ where: { key: "boardSessionHours" } }),
    currentCanEdit(),
    currentStaffRole(),
  ]);
  const isAdminNow = roleNow === "admin";
  const hoursNum = Number(boardHours?.value);
  const currentHours = Number.isFinite(hoursNum)
    ? Math.min(24, Math.max(1, Math.round(hoursNum)))
    : 8;

  const totalSignups = sessions.reduce((n, s) => n + s.signups.length, 0);

  // 進行中的講座：條件與公開看板 /board 完全一致（關閉、結束日已過、已到下架時間都不列）
  const now = new Date();
  const liveWebinars = allWebinars.filter(
    (w) =>
      w.isActive &&
      !hasEndedInTaipei(w.endDate) &&
      (!w.unpublishAt || w.unpublishAt > now),
  );
  const boardWebinars = liveWebinars.map((w) => ({
    id: w.id,
    slug: w.slug,
    title: w.title,
    // 日期在 server 端就轉成台北時間字串，避免丟 Date 給 client 後時區/水合不一致
    offlineLabel:
      w.unpublishAt?.toLocaleString("zh-TW", {
        timeZone: "Asia/Taipei",
        month: "numeric",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      }) ?? null,
    requests: w.requests,
  }));

  return (
    // 不設 max-w-4xl：名單表格欄位多，吃滿 layout 的 max-w-6xl 才放得下
    <div>
      <h1 className="mb-1 text-2xl font-bold">課程場次看板</h1>
      <p className="mb-6 text-sm text-gray-500">
        手動上架場次 → 定期上傳 1shop 訂單檔自動歸類報名 → 看板（/board）憑 4 位碼唯讀查看。
        目前 {sessions.length} 個場次、共 {totalSignups} 筆報名；
        另有 {boardWebinars.length} 場進行中講座（下方唯讀區塊）。
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

      {/* 講座（唯讀）：資料來源是 Webinar，與下方的課程場次各自獨立，只是併在同一頁看 */}
      <WebinarBoardSection
        webinars={boardWebinars}
        hiddenCount={allWebinars.length - liveWebinars.length}
      />

      {/* 場次列表 */}
      <h2 className="mb-3 text-lg font-bold text-gray-700">📚 課程場次</h2>
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
            isAdmin={isAdminNow}
            // 延期目標選單與「延期→/延期自」徽章要能解析其他場次的名稱
            sessionOptions={sessions.map((o) => ({ id: o.id, title: o.title }))}
            session={{
              id: s.id,
              title: s.title,
              eventDate: s.eventDate?.toISOString() ?? null,
              endDate: s.endDate?.toISOString() ?? null,
              keywords: s.keywords,
              isVisible: s.isVisible,
              adminNote: s.adminNote,
              groupCap: s.groupCap,
              groupCaps: s.groupCaps,
              accessCode: s.accessCode,
              meetingUrl: s.meetingUrl,
              meetingId: s.meetingId,
              meetingPassword: s.meetingPassword,
              meetingInfo: s.meetingInfo,
              financeTemplate: s.financeTemplate,
              signups: s.signups.map((g) => ({
                id: g.id,
                orderNo: g.orderNo,
                name: g.name,
                email: g.email,
                phone: g.phone,
                product: g.product,
                orderedAt: g.orderedAt?.toISOString() ?? null,
                meal: g.meal,
                groupNo: g.groupNo,
                isStaff: g.isStaff,
                isRetrain: g.isRetrain,
                deferredToSessionId: g.deferredToSessionId,
                deferredFromSessionId: g.deferredFromSessionId,
                smsNoticeAt: g.smsNoticeAt?.toISOString() ?? null,
                emailNoticeAt: g.emailNoticeAt?.toISOString() ?? null,
              })),
            }}
          />
        ))}
      </div>
    </div>
  );
}
