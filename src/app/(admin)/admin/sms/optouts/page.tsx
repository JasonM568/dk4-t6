import { pageGuardEditor } from "@/lib/auth/staff";
import { prisma } from "@/lib/db";
import { formatMobile } from "@/lib/sms/phone";
import { removeSmsOptOutAction } from "@/actions/sms";
import { OptOutForm } from "./optout-form";
import { SubmitButton } from "@/components/admin/submit-button";

export const metadata = { title: "簡訊退訂名單 — 管理後台" };

const TPE = { timeZone: "Asia/Taipei", hour12: false } as const;

const SOURCE_LABEL: Record<string, { label: string; cls: string }> = {
  USER: { label: "自行退訂", cls: "bg-gray-100 text-gray-600" },
  MANUAL: { label: "客服代退", cls: "bg-blue-100 text-blue-700" },
  INVALID: { label: "無法送達", cls: "bg-red-100 text-red-700" },
  PROVIDER: { label: "業者回報", cls: "bg-amber-100 text-amber-700" },
};

export default async function SmsOptOutsPage() {
  await pageGuardEditor();
  const rows = await prisma.smsOptOut.findMany({ orderBy: { createdAt: "desc" } });

  return (
    <div className="max-w-3xl">
      <h1 className="text-2xl font-bold">簡訊退訂名單</h1>
      <p className="mb-6 text-sm text-gray-500">
        發送前一律過濾。<strong>「自行退訂」與「客服代退」只擋行銷推播</strong>——
        已報名學員的上課提醒屬履約通知，不受行銷退訂影響；
        <strong>「無法送達」（空號／停用）則連上課提醒也一併擋掉</strong>。
      </p>

      <OptOutForm />

      <div className="mt-8">
        <h2 className="mb-3 font-bold">名單（{rows.length}）</h2>
        {rows.length === 0 ? (
          <p className="rounded-xl border border-gray-200 px-4 py-8 text-center text-sm text-gray-400">
            目前沒有退訂紀錄
          </p>
        ) : (
          <div className="overflow-hidden rounded-xl border border-gray-200">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-left text-gray-500">
                <tr>
                  <th className="px-4 py-3">手機</th>
                  <th className="px-4 py-3">來源</th>
                  <th className="px-4 py-3">原因</th>
                  <th className="px-4 py-3">時間</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {rows.map((r) => {
                  const s = SOURCE_LABEL[r.source] ?? {
                    label: r.source,
                    cls: "bg-gray-100 text-gray-600",
                  };
                  return (
                    <tr key={r.mobile}>
                      <td className="px-4 py-3 font-mono">{formatMobile(r.mobile)}</td>
                      <td className="px-4 py-3">
                        <span className={`rounded-full px-2 py-0.5 text-xs ${s.cls}`}>
                          {s.label}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-xs text-gray-500">
                        {r.reason ?? "—"}
                      </td>
                      <td className="px-4 py-3 text-xs text-gray-500">
                        {r.createdAt.toLocaleString("zh-TW", TPE)}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <form action={removeSmsOptOutAction.bind(null, r.mobile)}>
                          <SubmitButton
                            pendingText="移除中…"
                            className="rounded border border-gray-300 px-2 py-0.5 text-xs text-gray-500 hover:bg-gray-50"
                          >
                            移除
                          </SubmitButton>
                        </form>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
