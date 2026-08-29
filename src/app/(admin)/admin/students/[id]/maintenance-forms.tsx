"use client";

import { useActionState } from "react";
import {
  createEngagementAction,
  createHistoryAction,
  deleteEngagementAction,
  deleteHistoryAction,
  updateHistoryAction,
  updateStudentAction,
  type StudentMaintenanceState,
} from "@/actions/student-maintenance";

type History = { id: string; courseName: string; attendedAt: string; source: string | null; note: string | null };
type Engagement = { id: string; type: string; title: string; occurredAt: string; source: string | null; note: string | null };

const input = "rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-black focus:outline-none";
const labels: Record<string, string> = {
  BOOK_CLUB: "讀冊會",
  FREQUENCY_MAP: "頻率意識地圖",
  SEMINAR: "講座",
  EVENT: "其他活動",
  OTHER: "其他",
};

function Result({ state }: { state: StudentMaintenanceState }) {
  if (state?.error) return <p className="mt-2 text-sm text-red-600">{state.error}</p>;
  if (state?.success) return <p className="mt-2 text-sm text-emerald-700">✓ {state.success}</p>;
  return null;
}

export function StudentProfileForm({ student }: { student: { id: string; name: string | null; phone: string | null; email: string | null; legacyAccessStatus: string; legacyNote: string | null } }) {
  const [state, action, pending] = useActionState(updateStudentAction.bind(null, student.id), null);
  return <form action={action} className="rounded-xl border border-gray-200 p-5">
    <h2 className="font-bold">基本資料</h2>
    <div className="mt-4 grid gap-3 sm:grid-cols-2">
      <label className="text-sm">姓名<input name="name" defaultValue={student.name ?? ""} className={`mt-1 block w-full ${input}`} /></label>
      <label className="text-sm">手機<input name="phone" defaultValue={student.phone ?? ""} className={`mt-1 block w-full ${input}`} /></label>
      <label className="text-sm">Email<input name="email" type="email" defaultValue={student.email ?? ""} className={`mt-1 block w-full ${input}`} /></label>
      <label className="text-sm">舊官網狀態<select name="legacyAccessStatus" defaultValue={student.legacyAccessStatus} className={`mt-1 block w-full bg-white ${input}`}>
        <option value="UNKNOWN">尚未確認</option><option value="NONE">沒有舊站權限</option><option value="ACTIVE">仍在舊站觀看</option><option value="TO_MIGRATE">待轉移</option><option value="MIGRATED">已轉移</option>
      </select></label>
      <label className="text-sm sm:col-span-2">舊官網／內部備註<textarea name="legacyNote" defaultValue={student.legacyNote ?? ""} rows={3} className={`mt-1 block w-full ${input}`} placeholder="不可填寫密碼" /></label>
    </div>
    <p className="mt-3 text-xs text-gray-500">手機若已屬於另一位學員，系統會阻擋儲存，不會自動合併。Email 可供多人共用。</p>
    <button disabled={pending} className="mt-4 rounded-lg bg-black px-4 py-2 text-sm font-medium text-white disabled:opacity-50">{pending ? "儲存中…" : "儲存基本資料"}</button>
    <Result state={state} />
  </form>;
}

function HistoryRow({ studentId, history }: { studentId: string; history: History }) {
  const [state, action, pending] = useActionState(updateHistoryAction.bind(null, studentId, history.id), null);
  return <form action={action} className="rounded-lg border border-gray-200 bg-white p-3">
    <div className="grid gap-2 sm:grid-cols-[1fr_150px]">
      <input required name="courseName" defaultValue={history.courseName} className={input} aria-label="課程名稱" />
      <input name="attendedAt" type="date" defaultValue={history.attendedAt} className={input} aria-label="上課日期" />
      <input name="note" defaultValue={history.note ?? ""} className={`${input} sm:col-span-2`} placeholder="備註" />
    </div>
    <div className="mt-2 flex items-center gap-2"><span className="mr-auto text-xs text-gray-400">來源：{history.source ?? "歷史資料"}</span>
      <button disabled={pending} className="rounded border px-3 py-1 text-xs">{pending ? "儲存中…" : "儲存"}</button>
      <button type="submit" formAction={deleteHistoryAction.bind(null, studentId, history.id)} formNoValidate onClick={(e) => { if (!confirm(`確定刪除「${history.courseName}」這筆上課紀錄？`)) e.preventDefault(); }} className="rounded border border-red-200 px-3 py-1 text-xs text-red-600">刪除</button>
    </div><Result state={state} />
  </form>;
}

export function HistoriesSection({ studentId, histories }: { studentId: string; histories: History[] }) {
  const [state, action, pending] = useActionState(createHistoryAction.bind(null, studentId), null);
  return <section className="rounded-xl border border-indigo-200 bg-indigo-50/30 p-5">
    <div><h2 className="font-bold text-indigo-950">正式上課履歷</h2><p className="text-xs text-indigo-800/70">這裡才會計入「上過幾堂課」；影片觀看權限是另一項狀態。</p></div>
    <div className="mt-4 space-y-3">{histories.map((h) => <HistoryRow key={h.id} studentId={studentId} history={h} />)}{!histories.length && <p className="text-sm text-gray-500">尚無正式上課紀錄。</p>}</div>
    <form action={action} className="mt-4 rounded-lg border border-dashed border-indigo-300 bg-white p-3">
      <h3 className="text-sm font-semibold">＋補登上課紀錄</h3><div className="mt-2 grid gap-2 sm:grid-cols-[1fr_150px]">
        <input required name="courseName" className={input} placeholder="課程名稱" /><input name="attendedAt" type="date" className={input} />
        <input name="note" className={`${input} sm:col-span-2`} placeholder="備註（選填）" />
      </div><button disabled={pending} className="mt-2 rounded bg-indigo-700 px-3 py-1.5 text-xs font-medium text-white">{pending ? "新增中…" : "新增正式上課紀錄"}</button><Result state={state} />
    </form>
  </section>;
}

export function EngagementsSection({ studentId, engagements }: { studentId: string; engagements: Engagement[] }) {
  const [state, action, pending] = useActionState(createEngagementAction.bind(null, studentId), null);
  return <section className="rounded-xl border border-amber-200 bg-amber-50/40 p-5">
    <div><h2 className="font-bold text-amber-950">其他接觸紀錄</h2><p className="text-xs text-amber-800/70">讀冊會、問卷與講座只用於潛在名單，不計入正式上課堂數，也不會開通影片。</p></div>
    <div className="mt-4 space-y-2">{engagements.map((e) => <div key={e.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-amber-100 bg-white p-3 text-sm"><span className="rounded bg-amber-100 px-2 py-0.5 text-xs text-amber-800">{labels[e.type] ?? e.type}</span><strong>{e.title}</strong><span className="text-gray-400">{e.occurredAt || "日期未提供"}</span>{e.note && <span className="text-gray-500">{e.note}</span>}<form action={deleteEngagementAction.bind(null, studentId, e.id)} className="ml-auto"><button onClick={(event) => { if (!confirm(`確定刪除「${e.title}」這筆接觸紀錄？`)) event.preventDefault(); }} className="text-xs text-red-600">刪除</button></form></div>)}{!engagements.length && <p className="text-sm text-gray-500">尚無其他接觸紀錄。</p>}</div>
    <form action={action} className="mt-4 rounded-lg border border-dashed border-amber-300 bg-white p-3"><h3 className="text-sm font-semibold">＋新增接觸紀錄</h3><div className="mt-2 grid gap-2 sm:grid-cols-2">
      <select name="type" className={`bg-white ${input}`} defaultValue="BOOK_CLUB"><option value="BOOK_CLUB">讀冊會</option><option value="FREQUENCY_MAP">頻率意識地圖</option><option value="SEMINAR">講座</option><option value="EVENT">其他活動</option><option value="OTHER">其他</option></select>
      <input name="occurredAt" type="date" className={input} /><input required name="title" className={`${input} sm:col-span-2`} placeholder="活動或問卷名稱" /><input name="note" className={`${input} sm:col-span-2`} placeholder="備註（選填）" />
    </div><button disabled={pending} className="mt-2 rounded bg-amber-700 px-3 py-1.5 text-xs font-medium text-white">{pending ? "新增中…" : "新增其他接觸紀錄"}</button><Result state={state} /></form>
  </section>;
}
