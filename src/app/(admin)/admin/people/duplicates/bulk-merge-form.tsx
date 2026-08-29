"use client";

import { useActionState, useMemo, useState } from "react";
import type { BulkStudentMergeState } from "@/actions/person-roster";

type Candidate = { value: string; sourceLabel: string; targetLabel: string; moveCount: number; duplicateCount: number };

export function BulkMergeForm({ action, candidates, blockedCount }: {
  action: (previous: BulkStudentMergeState, formData: FormData) => Promise<BulkStudentMergeState>;
  candidates: Candidate[];
  blockedCount: number;
}) {
  const [state, formAction, pending] = useActionState(action, null);
  const [selected, setSelected] = useState<string[]>([]);
  const selectedSet = useMemo(() => new Set(selected), [selected]);
  const toggle = (value: string) => setSelected((current) => current.includes(value) ? current.filter((item) => item !== value) : current.length < 20 ? [...current, value] : current);
  return <section className="rounded-xl border border-purple-300 bg-purple-50 p-5">
    <div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="font-bold text-purple-950">安全批次合併</h2><p className="mt-1 text-sm text-gray-600">只有目前無身分衝突的候選可勾選；送出後伺服器仍會逐組重新查核。每批最多 20 組。</p></div><span className="rounded-full bg-white px-3 py-1 text-xs text-gray-600">可選 {candidates.length}｜衝突 {blockedCount}</span></div>
    {candidates.length > 0 ? <form action={formAction} className="mt-4">
      <button type="button" onClick={() => setSelected(selected.length ? [] : candidates.slice(0, 20).map((item) => item.value))} className="rounded border bg-white px-3 py-1.5 text-sm">{selected.length ? "清除選取" : "選取前 20 組"}</button>
      <div className="mt-3 max-h-80 space-y-2 overflow-y-auto">{candidates.map((candidate) => <label key={candidate.value} className="flex items-start gap-3 rounded-lg border bg-white p-3 text-sm"><input type="checkbox" name="mergePairs" value={candidate.value} checked={selectedSet.has(candidate.value)} onChange={() => toggle(candidate.value)} className="mt-1"/><span><b>{candidate.sourceLabel}</b> → 保留 {candidate.targetLabel}<small className="mt-1 block text-gray-500">搬入 {candidate.moveCount} 筆；重複略過 {candidate.duplicateCount} 筆</small></span></label>)}</div>
      <div className="mt-4 rounded-lg bg-white p-4"><p className="text-sm">已選 {selected.length} 組。請輸入 <b>MERGE {selected.length}</b></p><input required name="confirmation" autoComplete="off" placeholder={`MERGE ${selected.length}`} className="mt-2 w-full rounded border px-3 py-2"/><button disabled={pending || !selected.length} className="mt-3 rounded bg-purple-700 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">{pending ? "逐組合併中…" : `執行 ${selected.length} 組安全合併`}</button></div>
    </form> : <p className="mt-4 text-sm text-gray-500">目前沒有可安全批次合併的候選。</p>}
    {state?.error && <p className="mt-3 rounded bg-red-50 p-3 text-sm text-red-700">{state.error}</p>}
    {state && !state.error && <div className="mt-4 rounded-lg border bg-white p-4 text-sm"><b>本批結果</b><div className="mt-2 grid gap-2 sm:grid-cols-3"><span className="text-green-700">成功 {state.merged?.length ?? 0}</span><span className="text-amber-700">安全略過 {state.skipped?.length ?? 0}</span><span className="text-red-700">失敗 {state.failed?.length ?? 0}</span></div>{state.merged?.map((row) => <p key={row.operationId} className="mt-2 text-xs text-green-700">成功 {row.sourceLabel}｜操作 {row.operationId}</p>)}{state.skipped?.map((row) => <p key={`${row.sourceId}:${row.targetId}`} className="mt-2 text-xs text-amber-800">略過 {row.sourceLabel}：{row.reason}</p>)}{state.failed?.map((row) => <p key={`${row.sourceId}:${row.targetId}`} className="mt-2 text-xs text-red-700">失敗 {row.sourceLabel}：{row.reason}</p>)}</div>}
  </section>;
}
