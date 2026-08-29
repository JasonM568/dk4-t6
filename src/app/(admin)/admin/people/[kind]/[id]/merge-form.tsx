"use client";

import { useActionState } from "react";
import type { PersonClaimState } from "@/actions/person-roster";

type Preview = { canMerge: boolean; conflicts: string[]; warnings: string[]; moveHistories: string[]; duplicateHistories: string[]; moveEngagements: string[]; duplicateEngagements: string[] };

export function MergeStudentForm({ action, sourceName, returnTo, preview }: {
  action: (previous: PersonClaimState, formData: FormData) => Promise<PersonClaimState>;
  sourceName: string;
  returnTo?: string;
  preview?: Preview;
}) {
  const [state, formAction, pending] = useActionState(action, null);
  const phoneConflictOnly = preview?.conflicts.length === 1 && preview.conflicts[0] === "手機不同";
  const blocked = Boolean(preview?.conflicts.length && !phoneConflictOnly);
  return <form action={formAction} className="mt-3 rounded-lg border border-purple-200 bg-white p-4">
    {returnTo && <input type="hidden" name="returnTo" value={returnTo}/>}<h3 className="font-medium">合併來源：{sourceName}</h3>
    {preview && <div className="mt-3 grid gap-3 text-sm lg:grid-cols-2"><div className="rounded bg-green-50 p-3"><b className="text-green-800">將搬入</b><p className="mt-1">課程 {preview.moveHistories.length}、活動 {preview.moveEngagements.length}</p>{[...preview.moveHistories, ...preview.moveEngagements].length > 0 && <ul className="mt-2 list-disc pl-5 text-xs">{[...preview.moveHistories, ...preview.moveEngagements].map((value, index) => <li key={index}>{value}</li>)}</ul>}</div><div className="rounded bg-gray-50 p-3"><b>重複、將略過</b><p className="mt-1">課程 {preview.duplicateHistories.length}、活動 {preview.duplicateEngagements.length}</p>{[...preview.duplicateHistories, ...preview.duplicateEngagements].length > 0 && <ul className="mt-2 list-disc pl-5 text-xs">{[...preview.duplicateHistories, ...preview.duplicateEngagements].map((value, index) => <li key={index}>{value}</li>)}</ul>}</div></div>}
    {preview?.warnings.map((warning) => <p key={warning} className="mt-2 text-sm text-amber-700">⚠ {warning}</p>)}
    {phoneConflictOnly && <div className="mt-3 rounded border border-amber-300 bg-amber-50 p-3 text-sm"><b className="text-amber-900">手機不同，必須人工覆核</b><p className="mt-1 text-gray-600">請核對兩張卡的姓名、Email、手機及課程。合併後保留推薦主卡手機，來源手機仍保存在可還原快照。</p><textarea required minLength={4} name="reviewReason" placeholder="覆核原因，例如：已電話確認為同一人，舊手機已停用" className="mt-3 min-h-20 w-full rounded border bg-white px-3 py-2"/><label className="mt-2 flex items-start gap-2"><input required type="checkbox" name="phoneConflictOverride" value="CONFIRM" className="mt-1"/>我已人工核對兩支不同手機，確認兩張卡是同一人。</label></div>}
    {blocked ? <div className="mt-3 rounded bg-red-50 p-3 text-sm text-red-700">禁止合併：{preview?.conflicts.join("、")}</div> : <><label className="mt-3 flex items-start gap-2 text-sm"><input required type="checkbox" name="confirmation" value="MERGE" className="mt-1"/>我已核對差異，確認是同一人並接受上述搬入／略過結果。</label><button disabled={pending} onClick={(event) => { if (!confirm(`確定合併「${sourceName}」？`)) event.preventDefault(); }} className="mt-3 rounded-lg bg-purple-700 px-3 py-2 text-sm font-medium text-white disabled:opacity-50">{pending ? "合併中…" : phoneConflictOnly ? "人工覆核後合併" : "確認執行合併"}</button></>}
    {state?.error && <p className="mt-2 text-sm text-red-600">{state.error}</p>}
  </form>;
}
