import Link from "next/link";
import { pageGuardFullAdmin } from "@/lib/auth/staff";
import { prisma } from "@/lib/db";
import {
  isUserSideReason,
  REGISTER_ATTEMPT_RETENTION_DAYS,
  REGISTER_REASON,
  REGISTER_REASON_LABEL,
} from "@/lib/auth/register-log";

export const metadata = { title: "註冊狀況 — 管理後台" };

const TPE = { timeZone: "Asia/Taipei", hour12: false } as const;
const DAY_MS = 24 * 60 * 60 * 1000;

/** 多久沒有人註冊成功就該當成事故。
 *  2026-08-29 那次壞了 14 天沒人發現；平常每天 2–3 人註冊，
 *  連 3 天掛零已經明顯不對勁了。 */
const SILENT_DAYS_WARN = 3;

function fmt(d: Date) {
  return d.toLocaleString("zh-TW", { ...TPE, dateStyle: "short", timeStyle: "short" });
}

/** 遮蔽 email：留頭尾，中間打星號。後台看得出是誰、截圖外流傷害小 */
function maskEmail(email: string | null): string {
  if (!email) return "—";
  const [user, domain] = email.split("@");
  if (!domain) return email;
  const head = user.slice(0, 2);
  const tail = user.length > 3 ? user.slice(-1) : "";
  return `${head}${"*".repeat(Math.max(1, user.length - head.length - tail.length))}${tail}@${domain}`;
}

export default async function RegisterHealthPage() {
  // 整頁 adminOnly：失敗紀錄帶著未成功註冊者的 email 與手機
  await pageGuardFullAdmin();

  const now = Date.now();
  const since30 = new Date(now - 30 * DAY_MS);

  const [recent, lastSuccess, byReason, todayCount] = await Promise.all([
    // 明細只列失敗的：成功的那些沒有聯絡方式可看，列出來只是噪音
    prisma.registerAttempt.findMany({
      where: { reason: { not: REGISTER_REASON.SUCCESS }, createdAt: { gte: since30 } },
      orderBy: { createdAt: "desc" },
      take: 100,
    }),
    prisma.registerAttempt.findFirst({
      where: { reason: REGISTER_REASON.SUCCESS },
      orderBy: { createdAt: "desc" },
      select: { createdAt: true },
    }),
    prisma.registerAttempt.groupBy({
      by: ["reason"],
      where: { createdAt: { gte: since30 } },
      _count: { _all: true },
    }),
    prisma.registerAttempt.count({
      where: { createdAt: { gte: new Date(now - DAY_MS) } },
    }),
  ]);

  const successCount =
    byReason.find((r) => r.reason === REGISTER_REASON.SUCCESS)?._count._all ?? 0;
  const failRows = byReason
    .filter((r) => r.reason !== REGISTER_REASON.SUCCESS)
    .sort((a, b) => b._count._all - a._count._all);
  const failCount = failRows.reduce((n, r) => n + r._count._all, 0);
  // 系統面失敗＝扣掉「Email 已註冊過」「邀請碼無效」這類使用者自身狀況
  const systemFailCount = failRows
    .filter((r) => !isUserSideReason(r.reason))
    .reduce((n, r) => n + r._count._all, 0);

  // 多久沒有人成功註冊了。完全沒有紀錄時不報警——這張表是 2026-09-12 才開始記的，
  // 拿「查無資料」當事故會在上線當天就叫一次狼來了。
  const daysSilent = lastSuccess
    ? Math.floor((now - lastSuccess.createdAt.getTime()) / DAY_MS)
    : null;
  const alarm = daysSilent !== null && daysSilent >= SILENT_DAYS_WARN;

  return (
    <div className="max-w-4xl">
      <h1 className="text-2xl font-bold">註冊狀況</h1>
      <p className="mb-6 text-sm text-gray-500">
        每一次註冊嘗試都留痕。<strong>不存密碼</strong>；成功的紀錄只留時間、
        不存個資；失敗的才留聯絡方式（用途是把卡住的人找回來），
        且 {REGISTER_ATTEMPT_RETENTION_DAYS} 天後自動清除。
      </p>

      {/* 最重要的一格：這就是 2026-08-29 那 14 天缺的訊號 */}
      <div
        className={`mb-4 rounded-xl border px-4 py-3 ${
          alarm
            ? "border-red-300 bg-red-50 text-red-800"
            : "border-gray-200 bg-white text-gray-700"
        }`}
      >
        <div className="text-sm font-medium">
          {alarm ? "🚨 " : "✅ "}
          最後一次成功註冊：
          {lastSuccess ? (
            <>
              {fmt(lastSuccess.createdAt)}
              {daysSilent !== null && daysSilent > 0 && `（${daysSilent} 天前）`}
            </>
          ) : (
            "尚無紀錄（本表 2026-09-12 起才開始記錄）"
          )}
        </div>
        {alarm && (
          <p className="mt-1 text-xs">
            已經 {daysSilent} 天沒有人註冊成功。平常每天約 2–3 人——
            先自己到
            <Link href="/register" className="mx-1 font-medium underline">
              註冊頁
            </Link>
            走一次，並看下方失敗原因有沒有整批集中在同一類。
          </p>
        )}
      </div>

      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="近 30 天成功" value={successCount} />
        <Stat label="近 30 天失敗" value={failCount} />
        <Stat
          label="其中系統面失敗"
          value={systemFailCount}
          hint="已扣掉「Email 已註冊過」「邀請碼無效」"
          warn={systemFailCount > 0 && systemFailCount >= successCount}
        />
        <Stat label="最近 24 小時嘗試" value={todayCount} />
      </div>

      <h2 className="mb-2 font-bold">近 30 天失敗原因</h2>
      {failRows.length === 0 ? (
        <p className="mb-6 rounded-xl border border-gray-200 px-4 py-6 text-center text-sm text-gray-400">
          沒有任何失敗紀錄
        </p>
      ) : (
        <div className="mb-6 overflow-hidden rounded-xl border border-gray-200">
          {failRows.map((r) => {
            const userSide = isUserSideReason(r.reason);
            return (
              <div
                key={r.reason}
                className="flex items-center justify-between border-b border-gray-100 px-4 py-2 text-sm last:border-b-0"
              >
                <span>
                  {REGISTER_REASON_LABEL[r.reason] ?? r.reason}
                  {userSide ? (
                    <span className="ml-2 rounded-full bg-gray-100 px-1.5 py-0.5 text-xs text-gray-500">
                      使用者狀況
                    </span>
                  ) : (
                    <span className="ml-2 rounded-full bg-amber-100 px-1.5 py-0.5 text-xs text-amber-800">
                      系統面
                    </span>
                  )}
                </span>
                <span className="font-bold">{r._count._all}</span>
              </div>
            );
          })}
        </div>
      )}

      <h2 className="mb-2 font-bold">失敗明細（近 30 天，最多 100 筆）</h2>
      {recent.length === 0 ? (
        <p className="rounded-xl border border-gray-200 px-4 py-6 text-center text-sm text-gray-400">
          沒有任何失敗紀錄
        </p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-gray-200">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-left text-xs text-gray-500">
              <tr>
                <th className="px-3 py-2 font-medium">時間</th>
                <th className="px-3 py-2 font-medium">原因</th>
                <th className="px-3 py-2 font-medium">Email</th>
                <th className="px-3 py-2 font-medium">姓名</th>
                <th className="px-3 py-2 font-medium">手機</th>
                <th className="px-3 py-2 font-medium">說明</th>
              </tr>
            </thead>
            <tbody>
              {recent.map((a) => (
                <tr key={a.id} className="border-t border-gray-100">
                  <td className="whitespace-nowrap px-3 py-2 text-gray-500">
                    {fmt(a.createdAt)}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2">
                    {REGISTER_REASON_LABEL[a.reason] ?? a.reason}
                  </td>
                  <td className="px-3 py-2 font-mono text-xs">{maskEmail(a.email)}</td>
                  <td className="whitespace-nowrap px-3 py-2">{a.name || "—"}</td>
                  <td className="whitespace-nowrap px-3 py-2 font-mono text-xs">
                    {a.phone || "—"}
                  </td>
                  <td className="px-3 py-2 text-xs text-gray-500">{a.detail || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function Stat({
  label,
  value,
  hint,
  warn,
}: {
  label: string;
  value: number;
  hint?: string;
  warn?: boolean;
}) {
  return (
    <div
      className={`rounded-xl border px-4 py-3 ${
        warn ? "border-amber-300 bg-amber-50" : "border-gray-200 bg-white"
      }`}
    >
      <div className="text-xs text-gray-500">{label}</div>
      <div className="text-2xl font-bold">{value}</div>
      {hint && <div className="mt-0.5 text-[11px] text-gray-400">{hint}</div>}
    </div>
  );
}
