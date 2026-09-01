import Link from "next/link";
import { formatMobile, isOverseasPhone } from "@/lib/sms/phone";
import { CopyPhonesButton } from "../webinars/webinar-actions";

// 場次看板的「講座」區塊（唯讀）。
// 講座（Webinar/WebinarRequest）與課程場次（CourseSession/SessionSignup）是兩套獨立資料，
// 這裡只做「呈現」不做「合併」：讓看板一眼看完實體場次＋講座索取狀況，
// 編輯／刪除／寄信一律回「行銷推播 → 講座報名」，避免同一份資料兩處可改。
// 顯示條件與公開看板 /board 一致（isActive 且未結束／未到下架時間）。

export type BoardWebinarRequest = {
  id: string;
  name: string | null;
  email: string;
  /** 09XXXXXXXX 或海外 E.164；null = 2026-09-02 手機必填上線前的舊紀錄 */
  phone: string | null;
  /** SENT/DELIVERED/OPENED/CLICKED/BOUNCED/COMPLAINED/FAILED；null = 追蹤上線前的舊資料 */
  deliveryStatus: string | null;
  deliveryDetail: string | null;
};

export type BoardWebinar = {
  id: string;
  slug: string;
  title: string;
  /** 已在 server 端轉成台北時間字串，避免丟 Date 給 client */
  offlineLabel: string | null;
  requests: BoardWebinarRequest[];
};

// 與 webinars-manager 同一套標籤；這裡只用得到「有問題」的那幾種，其餘顯示為淡色
const DELIVERY_BADGES: Record<string, { label: string; className: string }> = {
  SENT: { label: "已寄出", className: "bg-gray-100 text-gray-500" },
  DELIVERED: { label: "已送達", className: "bg-green-50 text-green-700" },
  OPENED: { label: "已開信", className: "bg-green-100 text-green-800" },
  CLICKED: { label: "已點擊", className: "bg-emerald-100 text-emerald-800" },
  BOUNCED: { label: "退信", className: "bg-red-100 text-red-700" },
  COMPLAINED: { label: "檢舉垃圾信", className: "bg-red-100 text-red-700" },
  FAILED: { label: "寄送失敗", className: "bg-red-50 text-red-600" },
};

const PROBLEM_STATUSES = new Set(["BOUNCED", "COMPLAINED", "FAILED"]);

export function WebinarBoardSection({
  webinars,
  hiddenCount,
}: {
  webinars: BoardWebinar[];
  /** 已結束／已關閉、未列在這裡的講座數 */
  hiddenCount: number;
}) {
  const totalRequests = webinars.reduce((n, w) => n + w.requests.length, 0);

  return (
    <section className="mb-8">
      <div className="mb-3 flex flex-wrap items-end gap-x-3 gap-y-1">
        <h2 className="text-lg font-bold text-gray-700">🎤 講座報名（Email 索取）</h2>
        <span className="text-sm text-gray-400">
          進行中 {webinars.length} 場｜{totalRequests} 筆索取
        </span>
        <Link
          href="/admin/webinars"
          className="ml-auto text-sm text-blue-600 hover:underline"
        >
          管理講座 →
        </Link>
      </div>
      <p className="mb-3 text-xs text-gray-400">
        講座名單與課程場次名單是兩套獨立資料——索取講座連結<strong>不會</strong>
        進場次分組、簽到表或收支表。此處唯讀，要改內容或名單請到「行銷推播 → 講座報名」。
      </p>

      {webinars.length === 0 ? (
        <p className="rounded-xl border border-gray-200 px-4 py-6 text-center text-sm text-gray-400">
          目前沒有進行中的講座
          {hiddenCount > 0 && `（另有 ${hiddenCount} 場已結束／已關閉）`}
        </p>
      ) : (
        <div className="space-y-3">
          {webinars.map((w) => (
            <WebinarBoardCard key={w.id} webinar={w} />
          ))}
          {hiddenCount > 0 && (
            <p className="text-xs text-gray-400">
              另有 {hiddenCount} 場已結束／已關閉的講座未列出，見「講座報名」。
            </p>
          )}
        </div>
      )}
    </section>
  );
}

function WebinarBoardCard({ webinar }: { webinar: BoardWebinar }) {
  const problemCount = webinar.requests.filter(
    (r) => r.deliveryStatus && PROBLEM_STATUSES.has(r.deliveryStatus),
  ).length;

  return (
    <div className="rounded-xl border border-gray-200 p-4">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <span className="font-medium">{webinar.title}</span>
        <Link
          href={`/webinar/${webinar.slug}`}
          target="_blank"
          className="font-mono text-xs text-gray-400 hover:text-blue-600 hover:underline"
        >
          /webinar/{webinar.slug}
        </Link>
        {webinar.offlineLabel && (
          <span className="text-xs text-gray-400">{webinar.offlineLabel} 下架</span>
        )}
        {problemCount > 0 && (
          <span className="rounded-full bg-red-100 px-2.5 py-0.5 text-xs font-bold text-red-700">
            {problemCount} 筆退信/失敗
          </span>
        )}
        <span className="ml-auto rounded-full bg-black px-3 py-1 text-sm font-bold text-white">
          {webinar.requests.length} 人索取
        </span>
      </div>
      {webinar.requests.length > 0 && (
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <Link
            href={`/admin/sms?webinar=${webinar.id}`}
            className="rounded border border-indigo-300 px-2 py-0.5 text-xs text-indigo-700 transition hover:bg-indigo-50"
          >
            📱 發提醒簡訊
          </Link>
          <CopyPhonesButton requests={webinar.requests} />
        </div>
      )}
      {webinar.requests.length === 0 ? (
        <p className="text-sm text-gray-400">尚無人索取</p>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {webinar.requests.map((r) => {
            const badge = r.deliveryStatus ? DELIVERY_BADGES[r.deliveryStatus] : null;
            const isProblem = !!r.deliveryStatus && PROBLEM_STATUSES.has(r.deliveryStatus);
            return (
              <span
                key={r.id}
                className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-sm ${
                  isProblem ? "bg-red-50 text-red-700" : "bg-gray-100 text-gray-700"
                }`}
                title={r.deliveryDetail ?? undefined}
              >
                {r.name ?? r.email}
                {r.name && <span className="text-xs text-gray-400">{r.email}</span>}
                {r.phone && (
                  <span
                    className="font-mono text-xs text-gray-400"
                    title={isOverseasPhone(r.phone) ? "海外門號，不發簡訊" : undefined}
                  >
                    {formatMobile(r.phone)}
                    {isOverseasPhone(r.phone) && " 🌏"}
                  </span>
                )}
                {badge && (
                  <span className={`rounded-full px-1.5 py-0.5 text-xs ${badge.className}`}>
                    {badge.label}
                  </span>
                )}
              </span>
            );
          })}
        </div>
      )}
    </div>
  );
}
