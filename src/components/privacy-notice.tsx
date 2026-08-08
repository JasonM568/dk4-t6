import {
  PRIVACY_POLICY_SECTIONS,
  PRIVACY_POLICY_VERSION,
} from "@/lib/privacy";

/** 個資蒐集告知條款（可收合）。註冊頁、補填頁、會員資料頁共用同一份文字。 */
export function PrivacyNotice({ defaultOpen = false }: { defaultOpen?: boolean }) {
  return (
    <details
      open={defaultOpen}
      className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-xs text-gray-600"
    >
      <summary className="cursor-pointer select-none font-medium text-gray-700">
        個人資料蒐集告知事項（點擊展開，版本 {PRIVACY_POLICY_VERSION}）
      </summary>
      <div className="mt-2 space-y-2">
        {PRIVACY_POLICY_SECTIONS.map((s) => (
          <p key={s.title}>
            <span className="font-medium text-gray-700">{s.title}：</span>
            {s.body}
          </p>
        ))}
      </div>
    </details>
  );
}
