"use client";

import { SubmitButton } from "@/components/admin/submit-button";

export function DeleteGroupButton({
  groupName,
  memberCount,
  deleteAction,
}: {
  groupName: string;
  memberCount: number;
  deleteAction: () => Promise<void>;
}) {
  return (
    <form
      action={deleteAction}
      onSubmit={(e) => {
        if (
          !confirm(
            `確定刪除群組「${groupName}」？\n\n${memberCount} 筆名單會一併刪除（不影響歷史寄送紀錄與會員帳號）。`,
          )
        )
          e.preventDefault();
      }}
    >
      <SubmitButton
        pendingText="刪除中…"
        className="rounded-lg border border-red-300 px-3 py-1.5 text-sm text-red-600 transition hover:bg-red-50"
      >
        刪除群組
      </SubmitButton>
    </form>
  );
}
