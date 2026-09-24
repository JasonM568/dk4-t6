"use client";

import { useEffect, useRef, useState } from "react";
import { useActionState } from "react";
import {
  batchEnrollAction,
  batchRevokeEnrollmentAction,
  type BatchState,
  type RevokeState,
} from "@/actions/admin";
import { BatchResultTable } from "@/components/admin/batch-result-table";
import { enrollmentSource, formatDate } from "@/lib/format";

export type CourseMemberRow = {
  userId: string;
  name: string | null;
  email: string | null;
  source: string | null;
  orderId: string | null;
  createdAt: string;
};

/** 匯入表單：獨立元件，放在「載入場次名單」正下方。
 *
 *  2026-09-24 的事故：這段本來長在 CourseMembersManager 裡，而那個元件被排在
 *  「開通作業總覽」28 列表格、待開通名單、EDM 同步、來源統計之後——
 *  藍色區塊寫著「選定場次後…再由你確認一鍵開通」，但那顆確認鈕在幾百像素之外。
 *  管理員載完名單、看到表格說「可能漏開通」，合理地以為匯入失敗了。
 *  整批 26 人一個都沒開通，而且不是第一次；Vercel log 顯示零筆 POST，
 *  因為那顆按鈕從來沒被按到。動作要跟它所屬的流程放在一起。
 */
export function BatchEnrollForm({
  courseId,
  canEdit = true,
  initialList = "",
  sourceLabel = null,
}: {
  courseId: string;
  canEdit?: boolean;
  initialList?: string;
  sourceLabel?: string | null;
}) {
  const [addState, addAction, adding] = useActionState<BatchState, FormData>(
    batchEnrollAction,
    null,
  );
  // 名單文字框必須受控：伺服器換了名單要跟著換，
  // 但不能洗掉使用者手動編輯的內容
  const [list, setList] = useState(initialList);
  const lastInitial = useRef(initialList);
  useEffect(() => {
    if (lastInitial.current !== initialList) {
      lastInitial.current = initialList;
      setList(initialList);
    }
  }, [initialList]);

  if (!canEdit) return null;
  return (
      <form
        action={addAction}
        className="mb-6 space-y-2 rounded-xl border border-dashed border-gray-300 p-4"
      >
        <input type="hidden" name="courseId" value={courseId} />
        <label className="block text-sm font-medium">
          {sourceLabel ? `一鍵處理「${sourceLabel}」課後影片權限` : "新增觀看名單（一行一個 email，可「email,姓名」格式）"}
        </label>
        <textarea
          id="batch-enroll-list"
          name="list"
          rows={4}
          required
          value={list}
          onChange={(e) => setList(e.target.value)}
          placeholder={"student1@example.com\nstudent2@example.com,王小明"}
          className="w-full rounded-lg border border-gray-300 px-3 py-2 font-mono text-sm focus:border-black focus:outline-none"
        />
        <p className="text-xs text-gray-400">
          已註冊者直接開通；未註冊者建立待開通，日後以同一 Email 註冊會自動取得影片；同 Email 不同姓名會停止並要求人工確認。
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="submit"
            disabled={adding || list.trim().length === 0}
            className="rounded-lg bg-black px-4 py-2 text-sm font-medium text-white transition hover:bg-gray-800 disabled:opacity-50"
          >
            {adding ? "處理中，請勿關閉頁面…" : sourceLabel ? "確認並一鍵處理" : "新增到觀看名單"}
          </button>
          {/* 名單筆數顯示在按鈕旁：文字框沒帶到名單時一眼看得出來，
              不必等按下去才被瀏覽器的驗證泡泡擋 */}
          <span className="text-xs text-gray-500">
            {list.trim().length === 0
              ? "名單是空的——請先「載入場次名單」或直接貼上"
              : `待處理 ${list.split("\n").filter((l) => l.trim()).length} 筆`}
          </span>
        </div>
        {addState?.error && (
          <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
            {addState.error}
          </div>
        )}
        {addState?.summary && (
          <div className="space-y-2">
            <div className="rounded-lg bg-gray-50 px-3 py-2 text-sm font-medium">
              {addState.summary}
            </div>
            {addState.results && <BatchResultTable results={addState.results} />}
          </div>
        )}
      </form>
  );
}

export function CourseMembersManager({
  courseId,
  members,
  canEdit = true,
  initialList = "",
  sourceLabel = null,
}: {
  courseId: string;
  members: CourseMemberRow[];
  canEdit?: boolean; // 總教練(唯讀)為 false：只看名單，隱藏新增/移除/勾選
  initialList?: string;
  sourceLabel?: string | null;
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState("");
  // 名單文字框必須是「受控」的。用 defaultValue 會壞在這條路上：
  // 進頁面時還沒選場次 → initialList 是空字串 → textarea 掛載成空的；
  // 按「載入場次名單」是軟導航，client 元件實例被沿用，React 不會回頭改
  // 非受控 input 的值，所以文字框仍是空的。接著按送出，textarea 的 required
  // 讓瀏覽器擋下來——沒有任何請求送出，畫面也沒有錯誤，看起來就像「匯入沒反應」。
  // 2026-09-24 就是這樣讓 0919 台北場整批 26 人一個都沒開通。
  const [list, setList] = useState(initialList);
  const lastInitial = useRef(initialList);
  useEffect(() => {
    // 只在伺服器送來不同的名單時覆寫，不洗掉使用者手動編輯的內容
    if (lastInitial.current !== initialList) {
      lastInitial.current = initialList;
      setList(initialList);
    }
  }, [initialList]);
  const [revokeState, revokeAction, revoking] = useActionState<
    RevokeState,
    FormData
  >(batchRevokeEnrollmentAction.bind(null, courseId), null);

  // 搜尋：姓名/email 子字串即時過濾（名單已全量在前端，不需重新查詢）
  const query = search.trim().toLowerCase();
  const visible = query
    ? members.filter(
        (m) =>
          (m.name ?? "").toLowerCase().includes(query) ||
          (m.email ?? "").toLowerCase().includes(query),
      )
    : members;

  // 全選只作用在目前搜尋結果上
  const allSelected =
    visible.length > 0 && visible.every((m) => selected.has(m.userId));
  const toggle = (id: string) =>
    setSelected((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const toggleAll = () =>
    setSelected((cur) => {
      const next = new Set(cur);
      if (allSelected) visible.forEach((m) => next.delete(m.userId));
      else visible.forEach((m) => next.add(m.userId));
      return next;
    });

  return (
    <>
      {/* 新增觀看名單（總教練唯讀時隱藏） */}
      {/* 搜尋：即時過濾名單（放在 form 外，避免 Enter 誤觸移除送出） */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="搜尋姓名或 email"
          className="w-72 rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-black focus:outline-none"
        />
        {query && (
          <>
            <span className="text-sm text-gray-500">
              符合 {visible.length} / 共 {members.length} 位
            </span>
            <button
              type="button"
              onClick={() => setSearch("")}
              className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm text-gray-600 transition hover:bg-gray-50"
            >
              清除
            </button>
          </>
        )}
      </div>

      {/* 名單 + 勾選移除 */}
      <form action={revokeAction}>
        {/* 被搜尋過濾掉的已勾選列不會渲染 checkbox，補 hidden 欄位讓送出與「已勾選 N 位」一致 */}
        {canEdit &&
          [...selected]
            .filter((id) => !visible.some((m) => m.userId === id))
            .map((id) => (
              <input key={id} type="hidden" name="userIds" value={id} />
            ))}
        {canEdit && (
        <div className="mb-2 flex items-center gap-3">
          <span className="text-sm text-gray-500">已勾選 {selected.size} 位</span>
          <button
            type="submit"
            disabled={revoking || selected.size === 0}
            onClick={(e) => {
              if (
                !confirm(
                  `確定移除勾選的 ${selected.size} 位會員的觀看權限？\n（移除購買來源的權限前請特別確認）`,
                )
              )
                e.preventDefault();
            }}
            className="rounded-lg border border-red-300 px-3 py-1.5 text-sm text-red-600 transition hover:bg-red-50 disabled:opacity-40"
          >
            {revoking ? "移除中…" : "移除勾選的觀看權限"}
          </button>
          {revokeState?.success && (
            <span className="text-sm text-green-700">✓ {revokeState.success}</span>
          )}
          {revokeState?.error && (
            <span className="text-sm text-red-600">{revokeState.error}</span>
          )}
        </div>
        )}

        <div className="overflow-hidden rounded-xl border border-gray-200">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-left text-gray-500">
              <tr>
                {canEdit && (
                  <th className="px-3 py-3">
                    <input
                      type="checkbox"
                      checked={allSelected}
                      onChange={toggleAll}
                      aria-label="全選"
                    />
                  </th>
                )}
                <th className="px-4 py-3">#</th>
                <th className="px-4 py-3">會員</th>
                <th className="px-4 py-3">Email</th>
                <th className="px-4 py-3">來源</th>
                <th className="px-4 py-3">開通時間</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {visible.length === 0 && (
                <tr>
                  <td colSpan={canEdit ? 6 : 5} className="px-4 py-6 text-center text-gray-400">
                    {query ? "沒有符合搜尋的會員" : "這堂課還沒有任何會員開通"}
                  </td>
                </tr>
              )}
              {visible.map((m, i) => {
                const src = enrollmentSource(m.source, m.orderId);
                return (
                  <tr
                    key={m.userId}
                    className={selected.has(m.userId) ? "bg-indigo-50" : ""}
                  >
                    {canEdit && (
                      <td className="px-3 py-2">
                        <input
                          type="checkbox"
                          name="userIds"
                          value={m.userId}
                          checked={selected.has(m.userId)}
                          onChange={() => toggle(m.userId)}
                          aria-label={`選擇 ${m.email}`}
                        />
                      </td>
                    )}
                    <td className="px-4 py-2 font-mono text-gray-400">{i + 1}</td>
                    <td className="px-4 py-2">
                      {m.name ?? (
                        <span className="text-gray-300">（查無會員資料）</span>
                      )}
                    </td>
                    <td className="px-4 py-2 text-gray-500">{m.email ?? "—"}</td>
                    <td className="px-4 py-2">
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs ${src.className}`}
                      >
                        {src.text}
                      </span>
                    </td>
                    <td className="px-4 py-2 text-gray-400">
                      {formatDate(m.createdAt)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </form>
    </>
  );
}
