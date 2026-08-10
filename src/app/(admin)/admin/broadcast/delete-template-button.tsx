"use client";

import { SubmitButton } from "@/components/admin/submit-button";

/** 已儲存 EDM 範本的明確刪除入口；範本不影響歷史寄送紀錄。 */
export function DeleteTemplateButton({
  templateName,
  deleteAction,
}: {
  templateName: string;
  deleteAction: () => Promise<void>;
}) {
  return (
    <form
      action={deleteAction}
      onSubmit={(e) => {
        if (!confirm(`確定刪除範本「${templateName}」？\n\n刪除後無法復原，但不影響已寄出的信件紀錄。`))
          e.preventDefault();
      }}
    >
      <SubmitButton
        pendingText="刪除中…"
        className="shrink-0 rounded border border-red-300 px-2 py-1 text-xs font-medium text-red-600 transition hover:bg-red-50"
      >
        刪除範本
      </SubmitButton>
    </form>
  );
}
