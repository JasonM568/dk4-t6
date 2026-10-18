"use client";

import { useActionState, useState } from "react";
import Link from "next/link";
import {
  grantEnrollmentAction,
  searchMemberForEnrollAction,
  type EnrollmentEditState,
  type SingleEnrollMatch,
  type SingleEnrollSearchState,
} from "@/actions/admin";

type CourseOption = { id: string; title: string };

/** 單人開通：輸入姓名或 Email 找到會員 → 選課程 → 開通。
 *  找人與開通都是會回錯的表單，欄位一律受控（React 19 的 useActionState 回錯時會重置非受控欄位）。 */
export function SingleEnrollForm({ courses }: { courses: CourseOption[] }) {
  const [q, setQ] = useState("");
  const [state, formAction, pending] = useActionState<SingleEnrollSearchState, FormData>(
    searchMemberForEnrollAction,
    null,
  );
  const matches = state?.matches ?? null;

  return (
    <section className="mt-6 rounded-xl border border-gray-200 bg-white p-4">
      <h2 className="text-lg font-bold">單人開通</h2>
      <p className="mt-1 text-sm text-gray-500">
        輸入姓名或 Email 找到會員，選課程按「開通」即生效。查無會員的人請用下方「批次開通」，
        填預設密碼可直接建立帳號並開通。
      </p>

      <form action={formAction} className="mt-3 flex flex-col gap-2 sm:flex-row">
        <input
          name="q"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          maxLength={100}
          placeholder="姓名或 Email，例：王小明 或 ming@"
          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-black focus:outline-none"
        />
        <button
          type="submit"
          disabled={pending}
          className="shrink-0 rounded-lg bg-black px-5 py-2 text-sm font-medium text-white transition hover:bg-gray-800 disabled:opacity-50"
        >
          {pending ? "搜尋中…" : "搜尋會員"}
        </button>
      </form>

      {state?.error && (
        <div className="mt-3 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{state.error}</div>
      )}

      {matches && matches.length === 0 && (
        <div className="mt-3 rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-800">
          查無「{state?.query}」的會員。可能尚未註冊，或名字與 Email 都不含這個字串；
          未註冊的學員請用下方批次開通建立帳號。
        </div>
      )}

      {matches && matches.length > 0 && (
        <div className="mt-3 space-y-2">
          <p className="text-xs text-gray-400">
            找到 {matches.length} 位
            {matches.length >= 20 ? "（只顯示前 20 筆，請輸入更完整的姓名或 Email）" : ""}
          </p>
          {matches.map((m) => (
            <SingleEnrollRow key={`${state?.query}:${m.userId}`} match={m} courses={courses} />
          ))}
        </div>
      )}
    </section>
  );
}

function SingleEnrollRow({ match, courses }: { match: SingleEnrollMatch; courses: CourseOption[] }) {
  const [courseId, setCourseId] = useState("");
  // 這一列自己剛開通的課程：成功後從下拉選單拿掉、加進「已開通」清單，不用重新搜尋
  const [grantedIds, setGrantedIds] = useState<string[]>([]);
  const [state, action, pending] = useActionState<EnrollmentEditState, FormData>(
    async (prev, formData) => {
      const picked = String(formData.get("courseId") ?? "");
      const result = await grantEnrollmentAction(match.userId, prev, formData);
      if (result?.success && picked) {
        setGrantedIds((g) => (g.includes(picked) ? g : [...g, picked]));
        setCourseId("");
      }
      return result;
    },
    null,
  );

  const enrolledIds = new Set([...match.enrolledCourseIds, ...grantedIds]);
  const titleOf = new Map(courses.map((c) => [c.id, c.title]));
  const enrolledTitles = [...enrolledIds].map((id) => titleOf.get(id) ?? "（已下架課程）");
  const available = courses.filter((c) => !enrolledIds.has(c.id));

  return (
    <div className="rounded-lg border border-gray-200 px-4 py-3">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="font-medium">{match.name}</span>
        <span className="text-sm text-gray-500">{match.email || "（無 Email）"}</span>
        {match.archived && (
          <span className="rounded bg-gray-100 px-1.5 py-0.5 text-xs text-gray-500">已封存</span>
        )}
        <Link
          href={`/admin/members/${match.userId}`}
          className="text-xs text-blue-600 underline-offset-2 hover:underline"
        >
          會員詳情 →
        </Link>
      </div>
      <p className="mt-1 text-xs text-gray-400">
        已開通 {enrolledIds.size} 門{enrolledTitles.length > 0 ? `：${enrolledTitles.join("、")}` : ""}
      </p>

      <form action={action} className="mt-2 flex flex-col gap-2 sm:flex-row">
        <select
          name="courseId"
          value={courseId}
          onChange={(e) => setCourseId(e.target.value)}
          required
          disabled={available.length === 0}
          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-black focus:outline-none disabled:bg-gray-50 disabled:text-gray-400"
        >
          <option value="" disabled>
            {available.length === 0 ? "已開通全部課程" : "選擇要開通的課程"}
          </option>
          {available.map((c) => (
            <option key={c.id} value={c.id}>
              {c.title}
            </option>
          ))}
        </select>
        <button
          type="submit"
          disabled={pending || !courseId}
          className="shrink-0 rounded-lg bg-green-600 px-5 py-2 text-sm font-medium text-white transition hover:bg-green-700 disabled:opacity-50"
        >
          {pending ? "開通中…" : "開通"}
        </button>
      </form>

      {state?.error && <p className="mt-2 text-sm text-red-700">{state.error}</p>}
      {state?.success && <p className="mt-2 text-sm text-green-700">{state.success}</p>}
    </div>
  );
}
