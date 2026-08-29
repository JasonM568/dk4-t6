"use client";
import { useActionState } from "react";
import type { PersonClaimState } from "@/actions/person-roster";

export function DeleteStudentForm({ action, expected, historyCount, engagementCount, blocked }: {
  action: (prev: PersonClaimState, fd: FormData) => Promise<PersonClaimState>;
  expected: string; historyCount: number; engagementCount: number; blocked: boolean;
}) {
  const [state, formAction, pending] = useActionState(action, null);
  return <section className="rounded-xl border border-red-200 bg-red-50 p-5">
    <h2 className="font-bold text-red-900">永久刪除名單</h2>
    {blocked ? <p className="mt-2 text-sm text-red-700">此人物已註冊且有課程觀看權限，因此禁止刪除。若只是要從日常名單隱藏，請使用封存。</p> : <>
      <p className="mt-2 text-sm text-red-800">刪除後無法復原，會移除這張學員卡、{historyCount} 筆正式課程歷史及 {engagementCount} 筆活動／問卷紀錄。會員登入帳號、訂單、場次報名與其他模組資料不會刪除。</p>
      <form action={formAction} className="mt-4 space-y-3">
        <label className="block text-sm font-medium">刪除原因<input name="reason" required minLength={2} placeholder="例如：舊官網測試資料" className="mt-1 block w-full max-w-xl rounded-lg border border-red-300 bg-white px-3 py-2"/></label>
        <label className="block text-sm font-medium">輸入「{expected}」確認<input name="confirmation" required autoComplete="off" className="mt-1 block w-full max-w-xl rounded-lg border border-red-300 bg-white px-3 py-2"/></label>
        <button disabled={pending} onClick={(e) => { if (!confirm("這是永久刪除，確定繼續？")) e.preventDefault(); }} className="rounded-lg bg-red-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{pending ? "刪除中…" : "永久刪除這筆名單"}</button>
        {state?.error && <p className="text-sm text-red-700">{state.error}</p>}
      </form>
    </>}
  </section>;
}
