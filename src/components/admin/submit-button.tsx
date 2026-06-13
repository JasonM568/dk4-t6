"use client";

import { useFormStatus } from "react-dom";

/** 後台表單送出按鈕：送出期間自動 disable 並顯示處理中文字（放在 <form> 內使用） */
export function SubmitButton({
  children,
  pendingText = "處理中…",
  className = "",
}: {
  children: React.ReactNode;
  pendingText?: string;
  className?: string;
}) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className={`${className} disabled:cursor-not-allowed disabled:opacity-50`}
    >
      {pending ? (
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" />
          {pendingText}
        </span>
      ) : (
        children
      )}
    </button>
  );
}
