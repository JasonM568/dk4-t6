import type { BatchRowResult } from "@/actions/admin";

const STATUS_LABEL: Record<
  BatchRowResult["status"],
  { text: string; className: string }
> = {
  created: { text: "匯入成功", className: "bg-green-50 text-green-700" },
  enrolled: { text: "開通成功", className: "bg-green-50 text-green-700" },
  exists: { text: "已存在", className: "bg-blue-50 text-blue-700" },
  already: { text: "已有權限", className: "bg-blue-50 text-blue-700" },
  notfound: { text: "查無會員", className: "bg-amber-50 text-amber-700" },
  invalid: { text: "格式錯誤", className: "bg-amber-50 text-amber-700" },
  error: { text: "失敗", className: "bg-red-50 text-red-700" },
};

/** 批次匯入／批次開通的逐筆結果表 */
export function BatchResultTable({ results }: { results: BatchRowResult[] }) {
  return (
    <div className="overflow-hidden rounded-xl border border-gray-200">
      <table className="w-full text-sm">
        <thead className="bg-gray-50 text-left text-gray-500">
          <tr>
            <th className="px-4 py-2 font-medium">#</th>
            <th className="px-4 py-2 font-medium">Email</th>
            <th className="px-4 py-2 font-medium">結果</th>
            <th className="px-4 py-2 font-medium">說明</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {results.map((r, i) => {
            const s = STATUS_LABEL[r.status];
            return (
              <tr key={`${r.email}-${i}`}>
                <td className="px-4 py-2 font-mono text-gray-400">{i + 1}</td>
                <td className="px-4 py-2">{r.email}</td>
                <td className="px-4 py-2">
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs font-medium ${s.className}`}
                  >
                    {s.text}
                  </span>
                </td>
                <td className="px-4 py-2 text-gray-500">{r.detail ?? ""}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
