"use client";

import { useActionState } from "react";
import { updatePhoneAction, type CompleteProfileState } from "@/actions/auth";

export function PhoneForm({ currentPhone }: { currentPhone: string }) {
  const [state, formAction, pending] = useActionState<
    CompleteProfileState,
    FormData
  >(updatePhoneAction, null);

  return (
    <form action={formAction} className="flex flex-wrap items-start gap-2">
      <div className="min-w-48">
        <input
          name="phone"
          type="tel"
          required
          inputMode="numeric"
          defaultValue={currentPhone}
          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:border-black"
        />
        {state?.error && (
          <p className="mt-1 text-xs text-red-600">{state.error}</p>
        )}
      </div>
      <button
        type="submit"
        disabled={pending}
        className="rounded-lg bg-black px-4 py-2 text-sm font-medium text-white transition hover:bg-gray-800 disabled:opacity-50"
      >
        {pending ? "更新中…" : "更新手機"}
      </button>
    </form>
  );
}
