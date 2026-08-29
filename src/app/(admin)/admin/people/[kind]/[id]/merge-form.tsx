"use client";
import { useActionState } from "react";
import type { PersonClaimState } from "@/actions/person-roster";

export function MergeStudentForm({ action, sourceName }: { action: (prev: PersonClaimState, fd: FormData) => Promise<PersonClaimState>; sourceName: string }) {
  const [state, formAction, pending] = useActionState(action, null);
  return <form action={formAction} className="mt-2 rounded-lg border border-purple-200 bg-white p-3"><p className="text-sm">把「{sourceName}」的非重複課程與活動搬到目前人物；重複紀錄略過，來源卡隨後刪除。會員帳號與影片權限不移動。</p><label className="mt-2 flex items-start gap-2 text-sm"><input required type="checkbox" name="confirmation" value="MERGE" className="mt-1"/>我已核對聯絡資料，確認是同一人並保留目前這張卡。</label><button disabled={pending} onClick={(e) => { if (!confirm(`確定把「${sourceName}」合併進目前人物？`)) e.preventDefault(); }} className="mt-3 rounded-lg bg-purple-700 px-3 py-2 text-sm font-medium text-white disabled:opacity-50">{pending ? "合併中…" : "人工確認合併"}</button>{state?.error && <p className="mt-2 text-sm text-red-600">{state.error}</p>}</form>;
}
