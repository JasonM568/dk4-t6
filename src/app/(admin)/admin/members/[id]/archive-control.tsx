"use client";

import { useActionState } from "react";
import {
  archiveMemberAction,
  restoreMemberAction,
  type MemberArchiveState,
} from "@/actions/member-archive";

function Result({ state }: { state: MemberArchiveState }) {
  if (state?.error) return <p className="mt-2 text-sm text-red-600">{state.error}</p>;
  if (state?.success) return <p className="mt-2 text-sm text-emerald-700">✓ {state.success}</p>;
  return null;
}

export function ArchiveControl({
  userId,
  archive,
}: {
  userId: string;
  archive: { reason: string | null; archivedBy: string | null; archivedAt: string } | null;
}) {
  const [archiveState, archiveAction, archivePending] = useActionState(
    archiveMemberAction.bind(null, userId),
    null,
  );
  const [restoreState, restoreAction, restorePending] = useActionState(
    restoreMemberAction.bind(null, userId),
    null,
  );

  if (archive) {
    return <section className="mt-6 rounded-xl border border-amber-300 bg-amber-50 p-5">
      <h2 className="font-bold text-amber-900">此會員已封存</h2>
      <p className="mt-1 text-sm text-amber-800">封存原因：{archive.reason ?? "未填寫"}</p>
      <p className="mt-1 text-xs text-amber-700">{new Date(archive.archivedAt).toLocaleString("zh-TW")} · {archive.archivedBy ?? "未知操作者"}</p>
      <p className="mt-2 text-xs text-gray-600">封存只從一般會員列表隱藏，不影響舊官網登入、訂單及影片權限。</p>
      <form action={restoreAction}><button disabled={restorePending} className="mt-3 rounded-lg border border-amber-500 bg-white px-4 py-2 text-sm font-medium text-amber-800 disabled:opacity-50">{restorePending ? "處理中…" : "解除封存"}</button></form>
      <Result state={restoreState} />
    </section>;
  }

  return <section className="mt-6 rounded-xl border border-gray-200 p-5">
    <h2 className="font-bold">封存會員</h2>
    <p className="mt-1 text-sm text-gray-500">適合測試帳號或不需出現在日常名單的人。此操作可復原，不會刪除共用登入帳號。</p>
    <form action={archiveAction} className="mt-3">
      <label className="text-sm">封存原因<input required minLength={2} name="reason" placeholder="例如：舊官網功能測試帳號" className="mt-1 block w-full max-w-lg rounded-lg border border-gray-300 px-3 py-2" /></label>
      <button disabled={archivePending} onClick={(event) => { if (!confirm("確定封存這位會員？帳號不會刪除，可隨時解除封存。")) event.preventDefault(); }} className="mt-3 rounded-lg border border-red-300 px-4 py-2 text-sm font-medium text-red-700 disabled:opacity-50">{archivePending ? "封存中…" : "封存會員"}</button>
    </form>
    <Result state={archiveState} />
  </section>;
}
