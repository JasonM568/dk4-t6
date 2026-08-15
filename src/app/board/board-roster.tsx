"use client";

import { useMemo, useState } from "react";
import { isRetrainSignup } from "@/lib/session-roster";
// 比對規則與後台場次名單共用（@/lib/roster-search），同一關鍵字兩邊結果一致
import { normalizeQuery as norm, matchesText as matches, matchesTag } from "@/lib/roster-search";

export type BoardSignup = {
  id: string;
  name: string;
  product: string | null;
  isRetrain: boolean | null;
  meal: string | null;
  groupNo: number | null;
  isStaff: boolean;
};

export type BoardSession = {
  id: string;
  title: string;
  dateLabel: string | null;
  signups: BoardSignup[];
};

export type BoardWebinar = {
  id: string;
  title: string;
  requests: { id: string; email: string; name: string | null }[];
};

const isRetrain = isRetrainSignup;

export function BoardRoster({
  sessions,
  webinars,
}: {
  sessions: BoardSession[];
  webinars: BoardWebinar[];
}) {
  const [raw, setRaw] = useState("");
  const query = norm(raw);
  const searching = query.length > 0;

  const filtered = useMemo(() => {
    if (!searching) {
      return { sessions, webinars, hitCount: 0 };
    }
    const hitSessions = sessions
      .map((s) => {
        // 場次名稱命中 → 整場都算符合；否則只留名字／方案命中的人
        const wholeSession = matches(query, s.title, s.dateLabel);
        const signups = wholeSession
          ? s.signups
          : s.signups.filter((g) => matches(query, g.name, g.product) || matchesTag(query, g));
        return { ...s, signups, wholeSession };
      })
      .filter((s) => s.signups.length > 0);
    const hitWebinars = webinars
      .map((w) => {
        const wholeWebinar = matches(query, w.title);
        const requests = wholeWebinar
          ? w.requests
          : w.requests.filter((r) => matches(query, r.name, r.email));
        return { ...w, requests };
      })
      .filter((w) => w.requests.length > 0);
    const hitCount =
      hitSessions.reduce((n, s) => n + s.signups.length, 0) +
      hitWebinars.reduce((n, w) => n + w.requests.length, 0);
    return { sessions: hitSessions, webinars: hitWebinars, hitCount };
  }, [sessions, webinars, query, searching]);

  return (
    <>
      <div className="mb-6">
        <div className="relative">
          <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-gray-400">
            🔍
          </span>
          <input
            value={raw}
            onChange={(e) => setRaw(e.target.value)}
            placeholder="搜尋姓名、方案、場次名稱，或輸入「素」「複訓」「工作人員」"
            aria-label="搜尋名單"
            className="w-full rounded-xl border border-gray-300 py-2.5 pl-11 pr-20 text-sm focus:border-black focus:outline-none"
          />
          {raw && (
            <button
              type="button"
              onClick={() => setRaw("")}
              className="absolute right-3 top-1/2 -translate-y-1/2 rounded-lg px-2 py-1 text-xs text-gray-500 transition hover:bg-gray-100"
            >
              清除
            </button>
          )}
        </div>
        {searching && filtered.hitCount > 0 && (
          <p className="mt-2 text-sm text-gray-500">
            找到 {filtered.hitCount} 筆，分布 {filtered.sessions.length + filtered.webinars.length}{" "}
            個場次／講座
          </p>
        )}
      </div>

      {searching && filtered.hitCount === 0 && (
        <p className="rounded-2xl border border-gray-200 px-6 py-12 text-center text-gray-400">
          沒有符合「{raw}」的名單
        </p>
      )}

      {/* 講座索取狀況（第一順位）：訪客留 email 索取講座連結的名單 */}
      {filtered.webinars.length > 0 && (
        <div className="mb-10">
          <h2 className="mb-4 text-lg font-bold text-gray-700">🎤 講座報名（Email 索取）</h2>
          <div className="space-y-6">
            {filtered.webinars.map((w) => (
              <section key={w.id} className="rounded-2xl border border-gray-200 p-5">
                <div className="mb-3 flex flex-wrap items-center gap-3">
                  <h3 className="text-lg font-bold">{w.title}</h3>
                  <span className="ml-auto rounded-full bg-black px-3 py-1 text-sm font-bold text-white">
                    {w.requests.length} 人索取
                  </span>
                </div>
                {w.requests.length === 0 ? (
                  <p className="text-sm text-gray-400">尚無人索取</p>
                ) : (
                  <div className="flex flex-wrap gap-1.5">
                    {w.requests.map((r) => (
                      <span
                        key={r.id}
                        className="rounded-full bg-gray-100 px-2.5 py-1 text-sm text-gray-700"
                      >
                        {r.name ?? r.email}
                        {r.name && <span className="ml-1 text-xs text-gray-400">{r.email}</span>}
                      </span>
                    ))}
                  </div>
                )}
              </section>
            ))}
          </div>
        </div>
      )}

      {filtered.sessions.length > 0 && filtered.webinars.length > 0 && (
        <h2 className="mb-4 text-lg font-bold text-gray-700">📚 課程場次</h2>
      )}
      <div className="space-y-6">
        {filtered.sessions.map((s) => (
          <SessionCard key={s.id} session={s} searching={searching} />
        ))}
      </div>
    </>
  );
}

/** 未搜尋時的名字膠囊（維持原本看板樣式） */
function chip(g: BoardSignup) {
  return isRetrain(g) ? (
    <span
      key={g.id}
      className="rounded-full bg-amber-50 px-2.5 py-1 text-sm text-amber-800 ring-1 ring-amber-200"
    >
      {g.name}
      <span className="ml-1 text-xs text-amber-500">複訓</span>
    </span>
  ) : (
    <span key={g.id} className="rounded-full bg-gray-100 px-2.5 py-1 text-sm text-gray-700">
      {g.name}
    </span>
  );
}

/** 搜尋命中時的膠囊：把查人最常要知道的組別／新舊生／葷素一次標出來 */
function hitChip(g: BoardSignup) {
  return (
    <span
      key={g.id}
      className="rounded-full bg-yellow-50 px-2.5 py-1 text-sm text-gray-800 ring-1 ring-yellow-300"
    >
      {g.name}
      <span className="ml-1.5 text-xs text-gray-500">
        {g.isStaff ? "工作人員" : isRetrain(g) ? "複訓" : "新生"}
        {g.groupNo != null && ` · 第 ${g.groupNo} 組`}
        {g.meal === "VEG" && " · 素"}
      </span>
    </span>
  );
}

function SessionCard({
  session: s,
  searching,
}: {
  session: BoardSession & { wholeSession?: boolean };
  searching: boolean;
}) {
  // 工作人員獨立列（不分組、不算新舊生；用餐統計包含他們）
  const staff = s.signups.filter((g) => g.isStaff);
  const students = s.signups.filter((g) => !g.isStaff);
  const retrain = students.filter((g) => isRetrain(g));
  const fresh = students.length - retrain.length;
  const veg = s.signups.filter((g) => g.meal === "VEG").length;
  // 有任何人分了組 → 依組別分節顯示；全未分組 → 維持扁平名字雲
  const hasGroups = students.some((g) => g.groupNo != null);
  const groups = hasGroups
    ? [...new Set(students.map((g) => g.groupNo).filter((n): n is number => n != null))].sort(
        (a, b) => a - b,
      )
    : [];
  // 搜尋中且只命中部分人 → 統計數字會失真，改標「符合 N 人」並攤平顯示
  const partial = searching && !s.wholeSession;

  return (
    <section key={s.id} className="rounded-2xl border border-gray-200 p-5">
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <h2 className="text-lg font-bold">{s.title}</h2>
        {s.dateLabel && <span className="text-sm text-gray-400">{s.dateLabel}</span>}
        <div className="ml-auto flex flex-wrap items-center gap-1.5">
          {partial ? (
            <span className="rounded-full bg-yellow-400 px-3 py-1 text-sm font-bold text-black">
              符合 {s.signups.length} 人
            </span>
          ) : (
            <>
              <span className="rounded-full bg-black px-3 py-1 text-sm font-bold text-white">
                {students.length} 人
              </span>
              <span className="rounded-full bg-emerald-100 px-2.5 py-1 text-sm font-medium text-emerald-800">
                新生 {fresh}
              </span>
              <span className="rounded-full bg-amber-100 px-2.5 py-1 text-sm font-medium text-amber-800">
                舊生 {retrain.length}
              </span>
              {staff.length > 0 && (
                <span className="rounded-full bg-indigo-100 px-2.5 py-1 text-sm font-medium text-indigo-800">
                  工作人員 {staff.length}
                </span>
              )}
              {/* 葷 = 非素（含未標，訂餐往安全側算）；用餐統計含工作人員 */}
              <span className="rounded-full bg-gray-100 px-2.5 py-1 text-sm font-medium text-gray-600">
                葷 {s.signups.length - veg}｜素 {veg}
              </span>
            </>
          )}
        </div>
      </div>
      {s.signups.length === 0 ? (
        <p className="text-sm text-gray-400">尚無報名</p>
      ) : partial ? (
        <div className="flex flex-wrap gap-1.5">{s.signups.map(hitChip)}</div>
      ) : (
        <div className="space-y-3">
          {hasGroups ? (
            <>
              {groups.map((groupNo) => {
                const members = students.filter((g) => g.groupNo === groupNo);
                const groupVeg = members.filter((g) => g.meal === "VEG").length;
                return (
                  <div key={groupNo}>
                    <div className="mb-1.5 text-sm font-medium text-gray-500">
                      第 {groupNo} 組 · {members.length} 人{groupVeg > 0 && ` · 素 ${groupVeg}`}
                    </div>
                    <div className="flex flex-wrap gap-1.5">{members.map(chip)}</div>
                  </div>
                );
              })}
              {students.some((g) => g.groupNo == null) && (
                <div>
                  <div className="mb-1.5 text-sm font-medium text-amber-600">未分組</div>
                  <div className="flex flex-wrap gap-1.5">
                    {students.filter((g) => g.groupNo == null).map(chip)}
                  </div>
                </div>
              )}
            </>
          ) : (
            <div className="flex flex-wrap gap-1.5">{students.map(chip)}</div>
          )}
          {staff.length > 0 && (
            <div>
              <div className="mb-1.5 text-sm font-medium text-indigo-600">工作人員</div>
              <div className="flex flex-wrap gap-1.5">
                {staff.map((g) => (
                  <span
                    key={g.id}
                    className="rounded-full bg-indigo-50 px-2.5 py-1 text-sm text-indigo-800 ring-1 ring-indigo-200"
                  >
                    {g.name}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
