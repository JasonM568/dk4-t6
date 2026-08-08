"use client";

import { useActionState } from "react";
import {
  importMemberPhonesAction,
  type PhoneImportState,
} from "@/actions/admin";

export function PhoneImportForm() {
  const [state, formAction, pending] = useActionState<PhoneImportState, FormData>(
    importMemberPhonesAction,
    null,
  );
  const report = state?.report;

  return (
    <div className="space-y-6">
      <form
        action={formAction}
        className="flex flex-wrap items-center gap-3 rounded-xl border border-gray-200 p-4"
      >
        <input
          name="file"
          type="file"
          accept=".xlsx,.csv"
          required
          className="text-sm file:mr-3 file:rounded-lg file:border-0 file:bg-gray-100 file:px-4 file:py-2 file:text-sm file:font-medium hover:file:bg-gray-200"
        />
        <button
          disabled={pending}
          className="rounded-lg bg-black px-4 py-2 text-sm font-medium text-white transition hover:bg-gray-800 disabled:opacity-50"
        >
          {pending ? "比對回填中…" : "上傳並回填"}
        </button>
      </form>

      {state?.error && (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">
          {state.error}
        </p>
      )}

      {report && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat label="檔案資料列" value={report.totalRows} />
            <Stat label="有效 email＋手機" value={report.withContact} />
            <Stat label="對到會員" value={report.matchedMembers} />
            <Stat label="回填手機" value={report.filled} highlight />
          </div>

          <div className="rounded-xl border border-gray-200 p-4 text-sm">
            <h2 className="mb-2 font-semibold">查核明細</h2>
            <ul className="space-y-1 text-gray-600">
              <li>✅ 回填/更新 {report.filled} 筆（會員下次登入確認＋勾同意即完成）</li>
              <li>⏭ 已自行補齊（有同意紀錄）不動：{report.alreadyConsented} 位</li>
              <li>⏭ 先前回填過同號碼略過：{report.alreadyHadPhone} 位</li>
              {report.invalidPhone > 0 && (
                <li>⚠️ 手機無法辨識（市話/格式錯誤）：{report.invalidPhone} 列</li>
              )}
              <li>
                ❓ Email 對不到會員：{report.notMemberCount} 位
                （未註冊或報名時用了別的信箱）
              </li>
            </ul>
          </div>

          {report.conflicts.length > 0 && (
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm">
              <h2 className="mb-2 font-semibold text-amber-800">
                ⚠️ 號碼不一致（會員自填優先，未覆蓋）：{report.conflicts.length} 筆
              </h2>
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="text-amber-700">
                    <th className="py-1 pr-3">Email</th>
                    <th className="py-1 pr-3">姓名</th>
                    <th className="py-1 pr-3">會員自填</th>
                    <th className="py-1">訂單上的</th>
                  </tr>
                </thead>
                <tbody>
                  {report.conflicts.map((c) => (
                    <tr key={c.email} className="border-t border-amber-200">
                      <td className="py-1 pr-3">{c.email}</td>
                      <td className="py-1 pr-3">{c.name}</td>
                      <td className="py-1 pr-3 font-mono">{c.memberPhone}</td>
                      <td className="py-1 font-mono">{c.orderPhone}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {report.notMemberSample.length > 0 && (
            <details className="rounded-xl border border-gray-200 p-4 text-sm">
              <summary className="cursor-pointer font-semibold">
                對不到會員的 email（前 {report.notMemberSample.length} 筆，共{" "}
                {report.notMemberCount} 位）
              </summary>
              <ul className="mt-2 space-y-0.5 font-mono text-xs text-gray-600">
                {report.notMemberSample.map((e) => (
                  <li key={e}>{e}</li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}
    </div>
  );
}

function Stat({
  label,
  value,
  highlight = false,
}: {
  label: string;
  value: number;
  highlight?: boolean;
}) {
  return (
    <div
      className={`rounded-xl border p-3 text-center ${
        highlight ? "border-green-200 bg-green-50" : "border-gray-200"
      }`}
    >
      <div className="text-xs text-gray-500">{label}</div>
      <div className={`text-xl font-bold ${highlight ? "text-green-700" : ""}`}>
        {value}
      </div>
    </div>
  );
}
