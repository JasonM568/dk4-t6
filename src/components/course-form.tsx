"use client";

import { useActionState, useRef, useState } from "react";
import type { CourseFormState } from "@/actions/admin";
import { requestCourseImageUploadUrl } from "@/actions/admin";
import { createClient } from "@/lib/supabase/client";

// 圖片限制（與 Supabase bucket 設定一致；client 端先驗證只為即時提示）
const ALLOWED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];
const MAX_IMAGE_BYTES = 5 * 1024 * 1024; // 5MB

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
    groupId?: string | null;
    openToGroupUntil?: Date | null;
  };
  allCategories?: { id: string; name: string }[];
  allZones?: { id: string; name: string }[];
  submitLabel: string;
};

// 把單一檔案直傳 Supabase Storage（用 server 產生的簽名 URL，bytes 不經過 server action body）
async function uploadOne(
  file: File,
  prefix: "cover" | "intro",
): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  if (!ALLOWED_IMAGE_TYPES.includes(file.type)) {
    return { ok: false, error: `「${file.name}」格式不支援（限 JPG/PNG/WebP/GIF）` };
  }
  if (file.size > MAX_IMAGE_BYTES) {
    return { ok: false, error: `「${file.name}」超過 5MB，請壓縮後再上傳` };
  }
  const signed = await requestCourseImageUploadUrl(file.type, prefix);
  if (!signed.ok) return { ok: false, error: `「${file.name}」${signed.error}` };

  const supabase = createClient();
  const { error } = await supabase.storage
    .from(signed.bucket)
    .uploadToSignedUrl(signed.path, signed.token, file, { contentType: file.type });
  if (error) return { ok: false, error: `「${file.name}」上傳失敗：${error.message}` };

  return { ok: true, url: signed.publicUrl };
}

export function CourseForm({
  action,
  defaultValues = {},
  allCategories = [],
  allZones = [],
  submitLabel,
}: CourseFormProps) {
  const [state, formAction, pending] = useActionState<CourseFormState, FormData>(
    action,
    null,
  );
  const [groupId, setGroupId] = useState(defaultValues.groupId ?? "");

  const [coverImage, setCoverImage] = useState(defaultValues.coverImage ?? "");
  const [introImages, setIntroImages] = useState<string[]>(
    defaultValues.introImages ?? [],
  );
  const [coverUploading, setCoverUploading] = useState(false);
  const [introUploading, setIntroUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const introInputRef = useRef<HTMLInputElement>(null);
  const coverInputRef = useRef<HTMLInputElement>(null);

  const busy = pending || coverUploading || introUploading;

  async function onCoverChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadError(null);
    setCoverUploading(true);
    const res = await uploadOne(file, "cover");
    setCoverUploading(false);
    if (coverInputRef.current) coverInputRef.current.value = "";
    if (!res.ok) {
      setUploadError(res.error);
      return;
    }
    setCoverImage(res.url);
  }

  async function onIntroChange(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    if (files.length === 0) return;
    setUploadError(null);
    setIntroUploading(true);
    // 依選取順序逐張上傳，成功的接在既有清單之後
    for (const file of files) {
      const res = await uploadOne(file, "intro");
      if (!res.ok) {
        setUploadError(res.error);
        continue;
      }
      setIntroImages((prev) => [...prev, res.url]);
    }
    setIntroUploading(false);
    if (introInputRef.current) introInputRef.current.value = "";
  }

  function moveIntro(index: number, dir: -1 | 1) {
    setIntroImages((prev) => {
      const next = [...prev];
      const target = index + dir;
      if (target < 0 || target >= next.length) return prev;
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  }

  function removeIntro(index: number) {
    setIntroImages((prev) => prev.filter((_, i) => i !== index));
  }

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
      {allZones.length > 0 && (
        <Field label="所屬企業專區（選了專區＝不公開販售，僅專區會員可見）">
          <select
            name="groupId"
            value={groupId}
            onChange={(e) => setGroupId(e.target.value)}
            className="input"
          >
            <option value="">一般課程（公開販售）</option>
            {allZones.map((z) => (
              <option key={z.id} value={z.id}>
                {z.name}
              </option>
            ))}
          </select>
          {groupId && (
            <p className="mt-1 text-xs text-amber-600">
              專區課程不會出現在課程列表、不可購買，價格不對外顯示（可填
              0）；觀看權限需另外到「批次開通」逐課開通給專區會員。
            </p>
          )}
        </Field>
      )}
      {allZones.length > 0 && groupId && (
        <Field label="專區會員免開通觀看至（選填）">
          <input
            type="date"
            name="openToGroupUntil"
            defaultValue={
              defaultValues.openToGroupUntil
                ? defaultValues.openToGroupUntil
                    .toLocaleDateString("en-CA", { timeZone: "Asia/Taipei" })
                : ""
            }
            className="input"
          />
          <p className="mt-1 text-xs text-gray-500">
            設定後，此日期（含當天）前專區會員「不需逐課開通」即可觀看本課程；
            到期自動恢復「僅手動開通者可看」。留空 = 一律需手動開通。
          </p>
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
        {coverImage && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={coverImage}
            alt="目前封面"
            className="mb-2 h-28 rounded-lg border border-gray-200 object-cover"
          />
        )}
        {/* 直傳 Supabase；表單只送出網址，不夾帶檔案 bytes */}
        <input type="hidden" name="coverImage" value={coverImage} />
        <input
          ref={coverInputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp,image/gif"
          onChange={onCoverChange}
          disabled={busy}
          className="block w-full text-sm text-gray-600 file:mr-3 file:rounded-lg file:border-0 file:bg-gray-100 file:px-4 file:py-2 file:text-sm file:font-medium hover:file:bg-gray-200 disabled:opacity-50"
        />
        <p className="mt-1 text-xs text-gray-400">
          {coverUploading
            ? "封面上傳中…"
            : coverImage
              ? "選擇新檔案會取代目前封面"
              : "選擇檔案後會立即上傳；也可貼外部圖片網址："}
        </p>
        <input
          type="url"
          value={coverImage}
          onChange={(e) => setCoverImage(e.target.value)}
          placeholder="https://…（選填，可直接貼圖片網址）"
          className="input mt-1"
        />
      </Field>

      <Field label="課程介紹圖片（可多張，顯示在課程描述下方；可調整順序）">
        {introImages.length > 0 && (
          <ol className="mb-2 space-y-2">
            {introImages.map((url, i) => (
              <li
                key={url}
                className="flex items-center gap-3 rounded-lg border border-gray-200 p-2"
              >
                <span className="w-5 text-center text-xs text-gray-400">
                  {i + 1}
                </span>
                {/* hidden input 依目前陣列順序送出 → 決定前台顯示順序 */}
                <input type="hidden" name="introImages" value={url} />
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={url}
                  alt={`介紹圖 ${i + 1}`}
                  className="h-16 w-28 rounded object-cover"
                />
                <div className="ml-auto flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => moveIntro(i, -1)}
                    disabled={i === 0 || busy}
                    aria-label="上移"
                    className="rounded border border-gray-300 px-2 py-1 text-sm leading-none disabled:opacity-30"
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    onClick={() => moveIntro(i, 1)}
                    disabled={i === introImages.length - 1 || busy}
                    aria-label="下移"
                    className="rounded border border-gray-300 px-2 py-1 text-sm leading-none disabled:opacity-30"
                  >
                    ↓
                  </button>
                  <button
                    type="button"
                    onClick={() => removeIntro(i)}
                    disabled={busy}
                    aria-label="移除"
                    className="rounded border border-red-200 px-2 py-1 text-sm leading-none text-red-600 hover:bg-red-50 disabled:opacity-30"
                  >
                    ✕
                  </button>
                </div>
              </li>
            ))}
          </ol>
        )}
        <input
          ref={introInputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp,image/gif"
          multiple
          onChange={onIntroChange}
          disabled={busy}
          className="block w-full text-sm text-gray-600 file:mr-3 file:rounded-lg file:border-0 file:bg-gray-100 file:px-4 file:py-2 file:text-sm file:font-medium hover:file:bg-gray-200 disabled:opacity-50"
        />
        <p className="mt-1 text-xs text-gray-400">
          {introUploading
            ? "圖片上傳中…請稍候"
            : "可一次選多張，會立即上傳並接在既有圖之後；用 ↑ ↓ 調整順序，單張 5MB 內"}
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

      {uploadError && (
        <div className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">
          {uploadError}
        </div>
      )}
      {state?.error && (
        <div className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">
          {state.error}
        </div>
      )}

      <button
        type="submit"
        disabled={busy}
        className="rounded-lg bg-black px-5 py-2.5 font-medium text-white disabled:opacity-50"
      >
        {pending
          ? "儲存中…"
          : coverUploading || introUploading
            ? "圖片上傳中…"
            : submitLabel}
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
