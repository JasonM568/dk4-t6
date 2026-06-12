import { getPageStates } from "@/lib/site-pages";
import { togglePageAction } from "@/actions/admin";

export const metadata = { title: "分頁管理 — 管理後台" };

export default async function AdminSettingsPage() {
  const pages = await getPageStates();

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
    </div>
  );
}
