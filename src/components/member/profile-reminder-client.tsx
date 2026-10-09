"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

const STORAGE_KEY = "profile-reminder-dismissed-at";
const DISMISS_MS = 7 * 24 * 60 * 60 * 1000;

export function ProfileReminderClient({ href }: { href: string }) {
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    try {
      const dismissedAt = Number(localStorage.getItem(STORAGE_KEY));
      const elapsed = Date.now() - dismissedAt;
      if (dismissedAt > 0 && elapsed >= 0 && elapsed < DISMISS_MS) setHidden(true);
    } catch {
      // 無法讀取 localStorage 時，提醒仍可正常顯示。
    }
  }, []);

  if (hidden) return null;
  return (
    <aside className="mb-6 flex items-center justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950">
      <p>
        補充手機可收到課前通知與上課連結 →{" "}
        <Link href={href} className="font-medium underline">前往補填</Link>
      </p>
      <button
        type="button"
        aria-label="關閉補填提醒"
        className="shrink-0 rounded px-2 py-1 text-amber-700 hover:bg-amber-100"
        onClick={() => {
          try {
            localStorage.setItem(STORAGE_KEY, String(Date.now()));
          } catch {
            // 儲存失敗仍允許本次關閉。
          }
          setHidden(true);
        }}
      >
        關閉
      </button>
    </aside>
  );
}
