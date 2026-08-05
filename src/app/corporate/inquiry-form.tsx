"use client";

import { useActionState } from "react";
import {
  submitCorporateInquiryAction,
  type CorporateInquiryState,
} from "@/actions/corporate";
import {
  BUDGET_OPTIONS,
  HEADCOUNT_OPTIONS,
  TOPIC_OPTIONS,
  TRAINING_TYPE_OPTIONS,
} from "@/lib/corporate";

const INPUT_CLS =
  "w-full rounded-xl border border-gray-300 px-4 py-3 text-base focus:border-black focus:outline-none";

function Label({ children, required }: { children: React.ReactNode; required?: boolean }) {
  return (
    <label className="mb-1.5 block text-sm font-medium text-gray-700">
      {children}
      {required && <span className="ml-0.5 text-red-500">*</span>}
    </label>
  );
}

export function CorporateInquiryForm() {
  const [state, action, pending] = useActionState<CorporateInquiryState, FormData>(
    submitCorporateInquiryAction,
    null,
  );

  if (state?.success) {
    return (
      <div className="space-y-4">
        <div className="rounded-xl bg-green-50 px-4 py-4 text-green-800">
          ✅ {state.success}
        </div>
        <p className="text-sm leading-relaxed text-gray-600">
          我們也寄了一封確認信到您的信箱（若沒收到請檢查垃圾郵件夾）。
          若有急件或想補充需求，直接回覆該信即可。
        </p>
      </div>
    );
  }

  return (
    <form action={action} className="space-y-5">
      {/* 蜜罐欄位：真人看不到，機器人會填。欄位名避開 autofill 字典（同講座頁做法） */}
      <input
        type="text"
        name="hp_extra_note"
        tabIndex={-1}
        autoComplete="off"
        className="absolute -left-[9999px] h-0 w-0 opacity-0"
        aria-hidden="true"
      />

      <div className="grid gap-5 sm:grid-cols-2">
        <div>
          <Label required>公司／單位名稱</Label>
          <input type="text" name="companyName" required maxLength={100}
            placeholder="例：希望股份有限公司" autoComplete="organization" className={INPUT_CLS} />
        </div>
        <div>
          <Label required>聯絡人姓名</Label>
          <input type="text" name="contactName" required maxLength={50}
            placeholder="您的姓名" autoComplete="name" className={INPUT_CLS} />
        </div>
        <div>
          <Label>職稱</Label>
          <input type="text" name="contactTitle" maxLength={50}
            placeholder="例：人資經理（選填）" autoComplete="organization-title" className={INPUT_CLS} />
        </div>
        <div>
          <Label required>聯絡電話</Label>
          <input type="tel" name="phone" required maxLength={30}
            placeholder="例：0912-345-678" autoComplete="tel" className={INPUT_CLS} />
        </div>
        <div className="sm:col-span-2">
          <Label required>Email</Label>
          <input type="email" name="email" required maxLength={200}
            placeholder="用於接收確認信與後續聯繫" autoComplete="email" className={INPUT_CLS} />
        </div>
      </div>

      <div>
        <Label>感興趣的課程主題（可複選）</Label>
        <div className="grid gap-2 sm:grid-cols-2">
          {TOPIC_OPTIONS.map((t) => (
            <label
              key={t}
              className="flex cursor-pointer items-center gap-2.5 rounded-xl border border-gray-200 px-3.5 py-2.5 text-sm transition has-[:checked]:border-black has-[:checked]:bg-gray-50"
            >
              <input type="checkbox" name="topics" value={t} className="accent-black" />
              {t}
            </label>
          ))}
        </div>
      </div>

      <div className="grid gap-5 sm:grid-cols-2">
        <div>
          <Label>預計參訓人數</Label>
          <select name="headcount" defaultValue="" className={INPUT_CLS}>
            <option value="">請選擇（選填）</option>
            {HEADCOUNT_OPTIONS.map((o) => (
              <option key={o} value={o}>{o}</option>
            ))}
          </select>
        </div>
        <div>
          <Label>上課形式</Label>
          <select name="trainingType" defaultValue="" className={INPUT_CLS}>
            <option value="">請選擇（選填）</option>
            {TRAINING_TYPE_OPTIONS.map((o) => (
              <option key={o} value={o}>{o}</option>
            ))}
          </select>
        </div>
        <div>
          <Label>期望開課時段</Label>
          <input type="text" name="preferredTime" maxLength={100}
            placeholder="例：9 月平日下午（選填）" className={INPUT_CLS} />
        </div>
        <div>
          <Label>預算範圍</Label>
          <select name="budget" defaultValue="" className={INPUT_CLS}>
            <option value="">請選擇（選填）</option>
            {BUDGET_OPTIONS.map((o) => (
              <option key={o} value={o}>{o}</option>
            ))}
          </select>
        </div>
      </div>

      <div>
        <Label>需求說明</Label>
        <textarea name="message" rows={4} maxLength={2000}
          placeholder="想解決的問題、團隊背景、期望成果…都可以寫在這裡（選填）"
          className={INPUT_CLS} />
      </div>

      <button
        disabled={pending}
        className="w-full rounded-xl bg-black px-4 py-3.5 font-medium text-white transition hover:bg-gray-800 disabled:opacity-50"
      >
        {pending ? "送出中…" : "送出諮詢需求"}
      </button>
      {state?.error && <p className="text-sm text-red-600">{state.error}</p>}
      <p className="text-center text-xs text-gray-400">
        送出後我們將於 1–2 個工作天內與您聯繫，您的資料僅用於本次課程洽談
      </p>
    </form>
  );
}
