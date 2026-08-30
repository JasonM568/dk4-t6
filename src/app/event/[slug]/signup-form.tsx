"use client";

import { useActionState, useEffect, useRef, useState, useTransition } from "react";
import { submitSignupAction, type PublicSignupState } from "@/actions/session-signup";
import { createSessionCheckout, previewSessionPricing } from "@/actions/session-checkout";
import { MAX_ATTENDEES } from "@/lib/session-signup-page";
import { suggestEmailFix } from "@/lib/email-typo";

const INPUT =
  "w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-black focus:outline-none";

type Attendee = {
  name: string;
  phone: string;
  email: string;
  meal: "MEAT" | "VEG";
  retrain: boolean;
};

const blankAttendee = (): Attendee => ({
  name: "",
  phone: "",
  email: "",
  meal: "MEAT",
  retrain: false,
});

export function SessionSignupForm({
  slug,
  maxSeats,
  mode = "REQUEST",
  unitPrice,
  listPrice,
  retrainPrice,
}: {
  slug: string;
  /** 剩餘名額；undefined = 不限額。用來擋「加人加超過剩餘名額」 */
  maxSeats?: number;
  /** REQUEST = 送出待確認（手動收款）；PAYMENT = 前往平台金流付款 */
  mode?: "REQUEST" | "PAYMENT";
  /** PAYMENT 模式每人單價（新生特價，實收），用來即時顯示總額 */
  unitPrice?: number;
  /** 原價（純顯示，劃線對比特價）；null/undefined = 不顯示 */
  listPrice?: number | null;
  /** 複訓價（顯示方案用） */
  retrainPrice?: number | null;
}) {
  const [state, formAction, requestPending] = useActionState<PublicSignupState, FormData>(
    submitSignupAction.bind(null, slug),
    null,
  );

  // 所有欄位一律受控：React 19 的 form action 在送出後會重置非受控欄位，
  // 驗證失敗時使用者填的東西會整批消失（最多 6 位 × 5 欄，重打一次就跑光了）。
  const [email, setEmail] = useState("");
  const [note, setNote] = useState("");
  const [attendees, setAttendees] = useState<Attendee[]>([blankAttendee()]);

  // PAYMENT 模式：自行送到 createSessionCheckout，成功後 auto-submit PAYUNi 付款表單
  const formRef = useRef<HTMLFormElement>(null);
  const [payError, setPayError] = useState<string | null>(null);
  const [payPending, startPay] = useTransition();

  // 即時試算：PAYMENT 模式下，依各人手機/email 自動判新舊生與價格（純顯示，成交以伺服器為準）
  const [preview, setPreview] = useState<
    { lines: { tier: "NEW" | "RETRAIN"; price: number }[]; total: number } | null
  >(null);

  const limit = Math.min(MAX_ATTENDEES, maxSeats ?? MAX_ATTENDEES);
  const typoFix = suggestEmailFix(email);
  const fallbackTotal = unitPrice != null ? unitPrice * attendees.length : null;
  const total = preview?.total ?? fallbackTotal;

  // 手機/email 一變就重新試算（debounce 500ms）。至少要有第一位的手機才查。
  const contactsKey = attendees.map((a) => `${a.phone}|${a.email}`).join(",") + `|${email}`;
  useEffect(() => {
    if (mode !== "PAYMENT") return;
    const first = attendees[0];
    const valid = !!first?.phone && first.phone.replace(/\D/g, "").length >= 9;
    const contacts = attendees.map((a, i) => ({
      phone: a.phone,
      email: a.email || (i === 0 ? email : ""),
    }));
    // 全部走 debounce timeout（含清空）——避免在 effect 內同步 setState
    const t = setTimeout(async () => {
      if (!valid) {
        setPreview(null);
        return;
      }
      const res = await previewSessionPricing(slug, contacts);
      setPreview(res.ok ? { lines: res.lines, total: res.total } : null);
    }, 500);
    return () => clearTimeout(t);
    // contactsKey 已涵蓋 attendees 與 email 的變化
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contactsKey, mode, slug]);

  const patch = (i: number, changes: Partial<Attendee>) =>
    setAttendees((prev) => prev.map((a, idx) => (idx === i ? { ...a, ...changes } : a)));

  function handlePay(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setPayError(null);
    const fd = new FormData(e.currentTarget);
    startPay(async () => {
      const res = await createSessionCheckout(slug, fd);
      if (!res.ok) {
        setPayError(res.error);
        return;
      }
      // 動態建表單送到 PAYUNi 收銀台（同 BuyButton）
      const form = document.createElement("form");
      form.method = "POST";
      form.action = res.action;
      for (const [key, value] of Object.entries(res.fields)) {
        const input = document.createElement("input");
        input.type = "hidden";
        input.name = key;
        input.value = value;
        form.appendChild(input);
      }
      document.body.appendChild(form);
      form.submit();
    });
  }

  if (mode === "REQUEST" && state?.success) {
    return (
      <div className="rounded-2xl border border-green-200 bg-green-50 px-5 py-6 text-center">
        <p className="mb-1 text-lg font-bold text-green-800">報名已送出</p>
        <p className="text-sm leading-relaxed text-green-900">{state.success}</p>
        <p className="mt-3 text-xs text-green-700">
          沒收到信？請檢查垃圾郵件夾，或搜尋「希望學院」。
        </p>
      </div>
    );
  }

  const pending = mode === "PAYMENT" ? payPending : requestPending;
  const error = mode === "PAYMENT" ? payError : state?.error;

  return (
    <form
      ref={formRef}
      {...(mode === "PAYMENT" ? { onSubmit: handlePay } : { action: formAction })}
      className="space-y-5 rounded-2xl border border-gray-200 p-5"
    >
      {/* 價格方案：原價劃線 → 特價（同課程頁的呈現）；有複訓價也一併列出 */}
      {mode === "PAYMENT" && unitPrice != null && (
        <div className="rounded-xl bg-red-50/60 px-4 py-3">
          <div className="flex flex-wrap items-baseline gap-x-2">
            {listPrice != null && listPrice > unitPrice && (
              <span className="text-sm text-gray-400 line-through">
                原價 NT$ {listPrice.toLocaleString()}
              </span>
            )}
            <span className="text-2xl font-bold text-red-700">
              NT$ {unitPrice.toLocaleString()}
            </span>
            <span className="text-sm text-gray-600">／人</span>
            {listPrice != null && listPrice > unitPrice && (
              <span className="text-xs font-medium text-green-700">
                現省 NT$ {(listPrice - unitPrice).toLocaleString()}
              </span>
            )}
          </div>
          {retrainPrice != null && (
            <p className="mt-1 text-xs text-gray-600">
              量子舊生複訓價 NT$ {retrainPrice.toLocaleString()}／人——填手機後自動辨識，符合即自動套用
            </p>
          )}
        </div>
      )}

      <label className="block">
        <span className="mb-1 block text-sm font-medium">
          聯絡 Email <span className="text-red-600">*</span>
        </span>
        <input
          type="email"
          name="buyerEmail"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="報名確認信會寄到這個信箱"
          autoComplete="email"
          className={INPUT}
        />
        {typoFix && (
          <button
            type="button"
            onClick={() => setEmail(typoFix)}
            className="mt-1 text-xs text-amber-700 underline underline-offset-2"
          >
            是不是要打 {typoFix}？點此更正
          </button>
        )}
      </label>

      {attendees.map((a, i) => (
        <fieldset key={i} className="space-y-2.5 rounded-xl bg-gray-50 p-4">
          <legend className="px-1 text-sm font-medium text-gray-700">
            {i === 0 ? "參加者（報名人本人）" : `同行者 ${i}`}
          </legend>

          <label className="block">
            <span className="mb-1 block text-xs text-gray-600">
              姓名 <span className="text-red-600">*</span>
            </span>
            <input
              name={`attendee-${i}-name`}
              required={i === 0}
              value={a.name}
              onChange={(e) => patch(i, { name: e.target.value })}
              className={INPUT}
            />
          </label>

          <label className="block">
            <span className="mb-1 block text-xs text-gray-600">
              手機 <span className="text-red-600">*</span>
            </span>
            <input
              name={`attendee-${i}-phone`}
              required={i === 0}
              inputMode="tel"
              placeholder="09xxxxxxxx"
              value={a.phone}
              onChange={(e) => patch(i, { phone: e.target.value })}
              className={INPUT}
            />
            {/* 同行者一定要留本人號碼：訂購人代填自己的號碼會讓兩個人的上課紀錄併成一張卡 */}
            <span className="mt-1 block text-xs text-gray-500">
              {i === 0
                ? "課前通知會發到這支號碼"
                : "請填同行者本人的號碼，不要填報名人的"}
            </span>
          </label>

          <label className="block">
            <span className="mb-1 block text-xs text-gray-600">Email（選填）</span>
            <input
              type="email"
              name={`attendee-${i}-email`}
              value={a.email}
              onChange={(e) => patch(i, { email: e.target.value })}
              className={INPUT}
            />
          </label>

          <div className="flex flex-wrap items-center gap-4">
            <label className="flex items-center gap-2 text-sm">
              <span className="text-xs text-gray-600">餐點</span>
              <select
                name={`attendee-${i}-meal`}
                value={a.meal}
                onChange={(e) => patch(i, { meal: e.target.value as Attendee["meal"] })}
                className="rounded-lg border border-gray-300 px-2 py-1.5 text-sm"
              >
                <option value="MEAT">葷</option>
                <option value="VEG">素</option>
              </select>
            </label>
            {/* 手動勾選只在「送出待確認」模式；平台金流模式改成用手機/email 自動判定 */}
            {mode === "REQUEST" && (
              <label className="flex items-center gap-1.5 text-sm text-gray-700">
                <input
                  type="checkbox"
                  name={`attendee-${i}-retrain`}
                  checked={a.retrain}
                  onChange={(e) => patch(i, { retrain: e.target.checked })}
                  className="h-3.5 w-3.5"
                />
                我是舊生（複訓）
              </label>
            )}
          </div>

          {mode === "PAYMENT" && preview?.lines[i] && (
            <p
              className={`rounded-lg px-3 py-1.5 text-xs font-medium ${
                preview.lines[i].tier === "RETRAIN"
                  ? "bg-green-50 text-green-800"
                  : "bg-gray-100 text-gray-600"
              }`}
            >
              {preview.lines[i].tier === "RETRAIN"
                ? `偵測為量子舊生 → 複訓價 NT$ ${preview.lines[i].price.toLocaleString()}`
                : `新生 → NT$ ${preview.lines[i].price.toLocaleString()}`}
            </p>
          )}
        </fieldset>
      ))}

      <div className="flex flex-wrap items-center gap-3 text-sm">
        {attendees.length < limit && (
          <button
            type="button"
            onClick={() => setAttendees((prev) => [...prev, blankAttendee()])}
            className="rounded-lg border border-gray-400 px-3 py-1.5 transition hover:bg-gray-100"
          >
            ＋ 增加同行者
          </button>
        )}
        {attendees.length > 1 && (
          <button
            type="button"
            onClick={() => setAttendees((prev) => prev.slice(0, -1))}
            className="text-gray-500 underline underline-offset-2"
          >
            移除最後一位
          </button>
        )}
        {maxSeats !== undefined && maxSeats <= MAX_ATTENDEES && (
          <span className="text-xs text-gray-500">本場次尚餘 {maxSeats} 個名額</span>
        )}
      </div>

      <label className="block">
        <span className="mb-1 block text-sm font-medium">備註（選填）</span>
        <textarea
          name="note"
          rows={3}
          maxLength={1000}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          className={`${INPUT} resize-y`}
        />
      </label>

      {/* 蜜罐：真人看不到。欄位名刻意避開瀏覽器 autofill 字典（曾因取名 website 誤殺真人） */}
      <input
        type="text"
        name="hp_extra_note"
        tabIndex={-1}
        autoComplete="off"
        aria-hidden="true"
        className="absolute left-[-9999px] h-0 w-0 opacity-0"
      />

      {error && (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
      )}

      <button
        disabled={pending}
        className="w-full rounded-xl bg-gradient-to-br from-red-800 to-red-600 px-5 py-3 text-base font-bold text-white transition hover:opacity-90 disabled:opacity-50"
      >
        {mode === "PAYMENT"
          ? pending
            ? "前往付款中…"
            : total != null
              ? `前往付款 NT$ ${total.toLocaleString()}`
              : "前往付款"
          : pending
            ? "送出中…"
            : "送出報名"}
      </button>
      <p className="text-center text-xs text-gray-500">
        {mode === "PAYMENT"
          ? "點擊後前往付款頁，支援信用卡與 ATM；付款完成即自動完成報名。"
          : "送出後將收到確認信，依信中說明完成繳費才算報名成功。"}
      </p>
    </form>
  );
}
