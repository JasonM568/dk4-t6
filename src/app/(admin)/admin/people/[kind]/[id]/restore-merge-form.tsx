"use client";

import { useActionState } from "react";
import type { PersonClaimState } from "@/actions/person-roster";

export function RestoreMergeForm({ action, sourceLabel }: {
  action: (previous: PersonClaimState, formData: FormData) => Promise<PersonClaimState>;
  sourceLabel: string;
}) {
  const [state, formAction, pending] = useActionState(action, null);
  return <form action={formAction} className="mt-3 rounded-lg border border-amber-300 bg-amber-50 p-4">
    <p className="text-sm text-amber-950">還原後會重建來源卡「{sourceLabel}」，並把本次搬入的課程／活動移回。若合併後資料已被修改，系統會停止還原。</p>
    <label className="mt-3 flex items-start gap-2 text-sm"><input required type="checkbox" name="confirmation" value="RESTORE" className="mt-1"/>我已核對，確認還原這次合併。</label>
    <button disabled={pending} onClick={(event) => { if (!confirm(`確定還原「${sourceLabel}」的合併？`)) event.preventDefault(); }}
      className="mt-3 rounded-lg bg-amber-700 px-3 py-2 text-sm font-medium text-white disabled:opacity-50">{pending ? "還原中…" : "還原這次合併"}</button>
    {state?.error && <p className="mt-2 text-sm text-red-700">{state.error}</p>}
  </form>;
}
