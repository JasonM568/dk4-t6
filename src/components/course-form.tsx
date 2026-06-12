"use client";

import { useActionState } from "react";
import type { CourseFormState } from "@/actions/admin";

type CourseFormProps = {
  action: (prev: CourseFormState, formData: FormData) => Promise<CourseFormState>;
  defaultValues?: {
    slug?: string;
    courseCode?: string | null;
    title?: string;
    description?: string;
    coverImage?: string | null;
    introImages?: string[];
    listPrice?: number | null;
    price?: number;
    isPublished?: boolean;
    categoryIds?: string[];
  };
  allCategories?: { id: string; name: string }[];
  submitLabel: string;
};

export function CourseForm({
  action,
  defaultValues = {},
  allCategories = [],
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
      <div className="grid grid-cols-2 gap-4">
        <Field label="Slug（網址代稱，小寫英數與 -）">
          <input
            name="slug"
            required
            defaultValue={defaultValues.slug}
            placeholder="nextjs-fullstack"
            className="input"
          />
        </Field>
        <Field label="課程編號（選填，不可重複）">
          <input
            name="courseCode"
            defaultValue={defaultValues.courseCode ?? ""}
            placeholder="例：HA-001"
            className="input"
          />
        </Field>
      </div>

      {allCategories.length > 0 && (
        <Field label="課程分類（可複選；選項到「課程分類」頁維護）">
          <div className="flex flex-wrap gap-x-5 gap-y-2 rounded-lg border border-gray-200 p-3">
            {allCategories.map((c) => (
              <label key={c.id} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  name="categoryIds"
                  value={c.id}
                  defaultChecked={defaultValues.categoryIds?.includes(c.id)}
                />
                {c.name}
              </label>
            ))}
          </div>
        </Field>
      )}
      <Field label="課程描述">
        <textarea
          name="description"
          required
          rows={5}
          defaultValue={defaultValues.description}
          className="input"
        />
      </Field>
      <Field label="封面圖片（建議 16:9，5MB 內）">
        {defaultValues.coverImage && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={defaultValues.coverImage}
            alt="目前封面"
            className="mb-2 h-28 rounded-lg border border-gray-200 object-cover"
          />
        )}
        <input
          name="coverImageFile"
          type="file"
          accept="image/jpeg,image/png,image/webp,image/gif"
          className="block w-full text-sm text-gray-600 file:mr-3 file:rounded-lg file:border-0 file:bg-gray-100 file:px-4 file:py-2 file:text-sm file:font-medium hover:file:bg-gray-200"
        />
        <p className="mt-1 text-xs text-gray-400">
          {defaultValues.coverImage
            ? "選擇新檔案會取代目前封面；不選則維持原圖"
            : "也可以直接貼外部圖片網址："}
        </p>
        <input
          name="coverImage"
          type="url"
          defaultValue={defaultValues.coverImage ?? ""}
          placeholder="https://…（選填，有上傳檔案時以檔案為準）"
          className="input mt-1"
        />
      </Field>

      <Field label="課程介紹圖片（可多張，顯示在課程描述下方）">
        {(defaultValues.introImages ?? []).length > 0 && (
          <div className="mb-2 space-y-2">
            {(defaultValues.introImages ?? []).map((url) => (
              <label
                key={url}
                className="flex items-center gap-3 rounded-lg border border-gray-200 p-2"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={url}
                  alt="介紹圖"
                  className="h-16 w-28 rounded object-cover"
                />
                <span className="flex items-center gap-2 text-sm text-gray-600">
                  <input
                    type="checkbox"
                    name="keepIntroImages"
                    value={url}
                    defaultChecked
                  />
                  保留這張（取消勾選＝儲存時移除）
                </span>
              </label>
            ))}
          </div>
        )}
        <input
          name="introImageFiles"
          type="file"
          accept="image/jpeg,image/png,image/webp,image/gif"
          multiple
          className="block w-full text-sm text-gray-600 file:mr-3 file:rounded-lg file:border-0 file:bg-gray-100 file:px-4 file:py-2 file:text-sm file:font-medium hover:file:bg-gray-200"
        />
        <p className="mt-1 text-xs text-gray-400">
          可一次選多張，新圖會接在既有圖之後；單張 5MB 內
        </p>
      </Field>
      <div className="grid grid-cols-2 gap-4">
        <Field label="建議售價（選填，前台顯示劃線價）">
          <input
            name="listPrice"
            type="number"
            min={0}
            defaultValue={defaultValues.listPrice ?? ""}
            placeholder="例：3600"
            className="input"
          />
        </Field>
        <Field label="優惠價＝實際售價（新台幣整數）">
          <input
            name="price"
            type="number"
            min={0}
            required
            defaultValue={defaultValues.price ?? 0}
            className="input"
          />
        </Field>
      </div>
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
