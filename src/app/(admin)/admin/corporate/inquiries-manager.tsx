"use client";

import { useState, useTransition } from "react";
import { useActionState } from "react";
import {
  deleteInquiryAction,
  setCorporateNotifyEmailAction,
  updateInquiryAction,
  type CorporateInquiryState,
} from "@/actions/corporate";
import { INQUIRY_STATUSES, statusLabel } from "@/lib/corporate";
import { formatDate } from "@/lib/format";

type Inquiry = {
  id: string;
  companyName: string;
  contactName: string;
  contactTitle: string | null;
  email: string;
  phone: string;
  headcount: string | null;
  topics: string[];
  trainingType: string | null;
  preferredTime: string | null;
  budget: string | null;
  message: string | null;
  status: string;
  adminNote: string | null;
  createdAt: string;
};

const STATUS_BADGE: Record<string, string> = {
  NEW: "bg-amber-100 text-amber-800",
  CONTACTED: "bg-blue-100 text-blue-800",
  WON: "bg-green-100 text-green-800",
  CLOSED: "bg-gray-100 text-gray-500",
};

/** 新單通知收件人設定（存 SiteSetting，留空 = 關閉通知） */
export function NotifyEmailForm({ initialEmail }: { initialEmail: string }) {
  const [state, action, pending] = useActionState<CorporateInquiryState, FormData>(
    setCorporateNotifyEmailAction,
    null,
  );
  return (
    <form
      action={action}
      className="mb-6 flex flex-wrap items-center gap-2 rounded-xl border border-gray-200 bg-gray-50 px-4 py-3"
    >
      <span className="text-sm font-medium text-gray-700">📮 新單通知信箱</span>
      <input
        type="email"
        name="notifyEmail"
        defaultValue={initialEmail}
        placeholder="留空 = 不寄通知信"
        className="min-w-56 flex-1 rounded-lg border border-gray-300 px-3 py-1.5 text-sm focus:border-black focus:outline-none"
      />
      <button
        disabled={pending}
        className="rounded-lg bg-black px-3 py-1.5 text-sm text-white transition hover:bg-gray-800 disabled:opacity-50"
      >
        {pending ? "儲存中…" : "儲存"}
      </button>
      {state?.error && <span className="text-sm text-red-600">{state.error}</span>}
      {state?.success && <span className="text-sm text-green-700">{state.success}</span>}
    </form>
  );
}

function InquiryCard({ inquiry, canEdit }: { inquiry: Inquiry; canEdit: boolean }) {
  const [open, setOpen] = useState(inquiry.status === "NEW");
  const [state, action, pending] = useActionState<CorporateInquiryState, FormData>(
    updateInquiryAction.bind(null, inquiry.id),
    null,
  );
  const [isDeleting, startDelete] = useTransition();

  const details: [string, string | null][] = [
    ["職稱", inquiry.contactTitle],
    ["預計人數", inquiry.headcount],
    ["課程主題", inquiry.topics.length > 0 ? inquiry.topics.join("、") : null],
    ["上課形式", inquiry.trainingType],
    ["期望時段", inquiry.preferredTime],
    ["預算範圍", inquiry.budget],
  ];

  return (
    <div className="rounded-xl border border-gray-200">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 text-left"
      >
        <span
          className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_BADGE[inquiry.status] ?? "bg-gray-100 text-gray-500"}`}
        >
          {statusLabel(inquiry.status)}
        </span>
        <span className="font-bold">{inquiry.companyName}</span>
        <span className="text-sm text-gray-500">{inquiry.contactName}</span>
        <span className="ml-auto text-xs text-gray-400">
          {formatDate(inquiry.createdAt)}
        </span>
      </button>

      {open && (
        <div className="space-y-4 border-t border-gray-100 px-4 py-4">
          <div className="grid gap-x-6 gap-y-1.5 text-sm sm:grid-cols-2">
            <div>
              📧{" "}
              <a href={`mailto:${inquiry.email}`} className="text-blue-600 hover:underline">
                {inquiry.email}
              </a>
            </div>
            <div>
              📞{" "}
              <a href={`tel:${inquiry.phone}`} className="text-blue-600 hover:underline">
                {inquiry.phone}
              </a>
            </div>
            {details.map(
              ([label, value]) =>
                value && (
                  <div key={label} className="text-gray-700">
                    <span className="text-gray-400">{label}：</span>
                    {value}
                  </div>
                ),
            )}
          </div>
          {inquiry.message && (
            <p className="whitespace-pre-line rounded-lg bg-gray-50 px-3 py-2 text-sm leading-relaxed text-gray-700">
              {inquiry.message}
            </p>
          )}

          {canEdit ? (
            <form action={action} className="space-y-3 border-t border-gray-100 pt-3">
              <div className="flex flex-wrap items-center gap-2">
                <select
                  name="status"
                  defaultValue={inquiry.status}
                  className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm focus:border-black focus:outline-none"
                >
                  {INQUIRY_STATUSES.map((s) => (
                    <option key={s.value} value={s.value}>
                      {s.label}
                    </option>
                  ))}
                </select>
                <button
                  disabled={pending}
                  className="rounded-lg bg-black px-3 py-1.5 text-sm text-white transition hover:bg-gray-800 disabled:opacity-50"
                >
                  {pending ? "儲存中…" : "儲存"}
                </button>
                <button
                  type="button"
                  disabled={isDeleting}
                  onClick={() => {
                    if (!confirm(`確定刪除「${inquiry.companyName}」的諮詢單？`)) return;
                    startDelete(() => deleteInquiryAction(inquiry.id));
                  }}
                  className="ml-auto text-sm text-red-500 hover:underline disabled:opacity-50"
                >
                  刪除
                </button>
                {state?.error && <span className="text-sm text-red-600">{state.error}</span>}
                {state?.success && <span className="text-sm text-green-700">{state.success}</span>}
              </div>
              <textarea
                name="adminNote"
                defaultValue={inquiry.adminNote ?? ""}
                rows={2}
                placeholder="內部備註（報價、聯繫紀錄…），按「儲存」一併保存"
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-black focus:outline-none"
              />
            </form>
          ) : (
            inquiry.adminNote && (
              <p className="whitespace-pre-line border-t border-gray-100 pt-3 text-sm text-gray-500">
                備註：{inquiry.adminNote}
              </p>
            )
          )}
        </div>
      )}
    </div>
  );
}

export function InquiriesManager({
  inquiries,
  canEdit,
}: {
  inquiries: Inquiry[];
  canEdit: boolean;
}) {
  const [filter, setFilter] = useState<string>("ALL");
  const shown =
    filter === "ALL" ? inquiries : inquiries.filter((i) => i.status === filter);

  return (
    <div>
      <div className="mb-4 flex flex-wrap gap-1.5">
        {[{ value: "ALL", label: "全部" }, ...INQUIRY_STATUSES].map((s) => {
          const count =
            s.value === "ALL"
              ? inquiries.length
              : inquiries.filter((i) => i.status === s.value).length;
          return (
            <button
              key={s.value}
              type="button"
              onClick={() => setFilter(s.value)}
              className={`rounded-full px-3 py-1 text-sm transition ${
                filter === s.value
                  ? "bg-black text-white"
                  : "bg-gray-100 text-gray-600 hover:bg-gray-200"
              }`}
            >
              {s.label} {count}
            </button>
          );
        })}
      </div>

      <div className="space-y-3">
        {shown.length === 0 && (
          <p className="rounded-xl border border-gray-200 px-4 py-6 text-center text-sm text-gray-400">
            {filter === "ALL" ? "還沒有諮詢單——把 /corporate 頁面分享給企業客戶吧" : "此狀態沒有諮詢單"}
          </p>
        )}
        {shown.map((i) => (
          <InquiryCard key={i.id} inquiry={i} canEdit={canEdit} />
        ))}
      </div>
    </div>
  );
}
