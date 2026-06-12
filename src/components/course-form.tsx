"use client";

import { useActionState } from "react";
import type { CourseFormState } from "@/actions/admin";

type CourseFormProps = {
  action: (prev: CourseFormState, formData: FormData) => Promise<CourseFormState>;
  defaultValues?: {
    slug?: string;
    title?: string;
    description?: string;
    coverImage?: string | null;
    price?: number;
    isPublished?: boolean;
  };
  submitLabel: string;
};

export function CourseForm({
  action,
  defaultValues = {},
  submitLabel,
}: CourseFormProps) {
  const [state, formAction, pending] = useActionState<CourseFormState, FormData>(
    action,
    null,
  );

  return (
    <form action={formAction} className="max-w-2xl space-y-4">
      <Field label="標題">
        <input
          name="title"
          required
          defaultValue={defaultValues.title}
          className="input"
        />
      </Field>
      <Field label="Slug（網址代稱，小寫英數與 -）">
        <input
          name="slug"
          required
          defaultValue={defaultValues.slug}
          placeholder="nextjs-fullstack"
          className="input"
        />
      </Field>
      <Field label="課程描述">
        <textarea
          name="description"
          required
          rows={5}
          defaultValue={defaultValues.description}
          className="input"
        />
      </Field>
      <Field label="封面圖片網址（選填）">
        <input
          name="coverImage"
          type="url"
          defaultValue={defaultValues.coverImage ?? ""}
          placeholder="https://…"
          className="input"
        />
      </Field>
      <Field label="售價（新台幣整數）">
        <input
          name="price"
          type="number"
          min={0}
          required
          defaultValue={defaultValues.price ?? 0}
          className="input"
        />
      </Field>
      <label className="flex items-center gap-2 text-sm">
        <input
          name="isPublished"
          type="checkbox"
          defaultChecked={defaultValues.isPublished}
        />
        立即上架
      </label>

      {state?.error && (
        <div className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">
          {state.error}
        </div>
      )}

      <button
        type="submit"
        disabled={pending}
        className="rounded-lg bg-black px-5 py-2.5 font-medium text-white disabled:opacity-50"
      >
        {pending ? "儲存中…" : submitLabel}
      </button>

      <style>{`
        .input {
          width: 100%;
          border: 1px solid #d1d5db;
          border-radius: 0.5rem;
          padding: 0.5rem 0.75rem;
          outline: none;
        }
        .input:focus { border-color: #000; }
      `}</style>
    </form>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="mb-1 block text-sm font-medium">{label}</label>
      {children}
    </div>
  );
}
