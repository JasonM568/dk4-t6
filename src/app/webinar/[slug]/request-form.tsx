"use client";

import { useEffect, useState } from "react";
import { useActionState } from "react";
import {
  requestWebinarLinkAction,
  type WebinarRequestState,
} from "@/actions/webinar";

// 常見信箱網域打錯偵測（防呆第一關：信寄得再好，地址錯了都收不到）
const DOMAIN_FIXES: Record<string, string> = {
  "gmial.com": "gmail.com",
  "gamil.com": "gmail.com",
  "gmali.com": "gmail.com",
  "gmaill.com": "gmail.com",
  "gmail.co": "gmail.com",
  "gmail.con": "gmail.com",
  "gmail.comm": "gmail.com",
  "gmil.com": "gmail.com",
  "hotmial.com": "hotmail.com",
  "hotmall.com": "hotmail.com",
  "hotmail.co": "hotmail.com",
  "yahooo.com": "yahoo.com",
  "yahoo.co": "yahoo.com.tw",
  "yaho.com.tw": "yahoo.com.tw",
  "outlok.com": "outlook.com",
  "icloud.co": "icloud.com",
  "icould.com": "icloud.com",
};

function suggestFix(email: string): string | null {
  const at = email.lastIndexOf("@");
  if (at < 1) return null;
  const domain = email.slice(at + 1).toLowerCase();
  const fixed = DOMAIN_FIXES[domain];
  return fixed ? email.slice(0, at + 1) + fixed : null;
}

/** 依信箱網域給對應的找信指引 */
function searchTips(email: string): string[] {
  const domain = email.split("@")[1]?.toLowerCase() ?? "";
  if (domain.includes("gmail")) {
    return [
      "打開 Gmail，在最上方搜尋框輸入：in:anywhere 希望學院",
      "也檢查「促銷內容」「社交網路」分頁與「垃圾郵件」資料夾",
    ];
  }
  if (domain.includes("yahoo")) {
    return ["打開 Yahoo 信箱，檢查「垃圾信件匣」，或搜尋「希望學院」"];
  }
  if (domain.includes("hotmail") || domain.includes("outlook") || domain.includes("live")) {
    return ["打開 Outlook/Hotmail，檢查「垃圾郵件」資料夾，或搜尋「希望學院」"];
  }
  return ["到信箱搜尋「希望學院」，並檢查垃圾郵件資料夾"];
}

export function WebinarRequestForm({
  slug,
  senderEmail,
}: {
  slug: string;
  senderEmail: string;
}) {
  const [state, action, pending] = useActionState<WebinarRequestState, FormData>(
    requestWebinarLinkAction.bind(null, slug),
    null,
  );
  const [email, setEmail] = useState("");
  const [cooldown, setCooldown] = useState(0);

  const suggestion = suggestFix(email.trim());

  // 寄出成功後啟動 60 秒重寄倒數（與伺服器端限流一致）
  useEffect(() => {
    if (state?.success) setCooldown(60);
  }, [state]);
  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  if (state?.success) {
    return (
      <div className="space-y-4 text-left">
        <div className="rounded-xl bg-green-50 px-4 py-3 text-green-800">
          ✅ {state.success}
          <div className="mt-1 text-sm">
            寄送至：<span className="font-mono font-bold">{email}</span>
          </div>
        </div>

        <div className="rounded-xl border border-gray-200 p-4 text-sm leading-relaxed text-gray-700">
          <div className="mb-2 font-bold">📬 找不到信？照這三步：</div>
          <ol className="list-inside list-decimal space-y-1.5">
            <li>
              找主旨含「講座」、寄件者{" "}
              <span className="font-mono text-xs">{senderEmail}</span> 的信（1–2 分鐘內送達）
            </li>
            {searchTips(email).map((tip) => (
              <li key={tip}>{tip}</li>
            ))}
          </ol>
          <div className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-amber-800">
            💡 <strong>找到信後請做兩件事</strong>，之後的通知才不會再被歸到垃圾郵件：
            ① 若信在垃圾郵件夾，點「回報為非垃圾郵件／移至收件匣」
            ② 把 <span className="font-mono text-xs">{senderEmail}</span> 加入通訊錄
          </div>
        </div>

        <form action={action} className="flex items-center gap-2">
          <input type="hidden" name="email" value={email} />
          <button
            disabled={pending || cooldown > 0}
            className="rounded-lg border border-gray-300 px-4 py-2 text-sm text-gray-600 transition hover:bg-gray-50 disabled:opacity-50"
          >
            {cooldown > 0 ? `沒收到？${cooldown} 秒後可重寄` : "重寄一次"}
          </button>
          <button
            type="button"
            onClick={() => location.reload()}
            className="text-sm text-gray-400 underline hover:text-gray-600"
          >
            打錯信箱？重新輸入
          </button>
        </form>
      </div>
    );
  }

  return (
    <form action={action} className="space-y-3">
      {/* 蜜罐欄位：真人看不到，機器人會填 */}
      <input
        type="text"
        name="website"
        tabIndex={-1}
        autoComplete="off"
        className="absolute -left-[9999px] h-0 w-0 opacity-0"
        aria-hidden="true"
      />
      <input
        type="email"
        name="email"
        required
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder="輸入你的 Email"
        className="w-full rounded-xl border border-gray-300 px-4 py-3 text-base focus:border-black focus:outline-none"
      />
      {suggestion && (
        <button
          type="button"
          onClick={() => setEmail(suggestion)}
          className="w-full rounded-lg bg-amber-50 px-3 py-2 text-left text-sm text-amber-800 transition hover:bg-amber-100"
        >
          ⚠️ 信箱網域可能打錯了——你是不是要輸入{" "}
          <span className="font-mono font-bold">{suggestion}</span>？點此修正
        </button>
      )}
      <button
        disabled={pending}
        className="w-full rounded-xl bg-black px-4 py-3 font-medium text-white transition hover:bg-gray-800 disabled:opacity-50"
      >
        {pending ? "寄送中…" : "索取講座連結"}
      </button>
      {state?.error && <p className="text-sm text-red-600">{state.error}</p>}
      <p className="text-center text-xs text-gray-400">
        送出後系統會將講座連結寄到你的信箱
      </p>
    </form>
  );
}
