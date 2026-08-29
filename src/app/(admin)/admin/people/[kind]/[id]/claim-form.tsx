"use client";
import { useActionState } from "react";
import type { PersonClaimState } from "@/actions/person-roster";

export function ClaimForm({ action, label }: { action: (prev: PersonClaimState, fd: FormData) => Promise<PersonClaimState>; label: string }) {
  const [state, formAction, pending] = useActionState(action, null);
  return <form action={formAction} className="mt-3 rounded-lg border border-purple-200 bg-purple-50 p-3 text-sm">
    <label className="flex items-start gap-2"><input type="checkbox" name="confirmation" value="LINK" className="mt-1" required/><span>我已人工核對姓名、Email／手機，確認這張歷史學員卡屬於 <b>{label}</b>。連結後課程歷史會顯示在此會員人物頁。</span></label>
    <button disabled={pending} className="mt-3 rounded-lg bg-purple-700 px-3 py-2 font-medium text-white disabled:opacity-50">{pending ? "連結中…" : "確認連結身分"}</button>
    {state?.error && <p className="mt-2 text-red-600">{state.error}</p>}{state?.success && <p className="mt-2 text-green-700">{state.success}</p>}
  </form>;
}
