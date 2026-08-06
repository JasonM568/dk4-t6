"use client";

import { useActionState, useState } from "react";
import {
  createCustomPageAction,
  updateCustomPageAction,
  deleteCustomPageAction,
  type CustomPageFormState,
} from "@/actions/pages";
import { requestCourseImageUploadUrl } from "@/actions/admin";
import { createClient } from "@/lib/supabase/client";

export type CustomPageRow = {
  id: string;
  slug: string;
  title: string;
  content: string;
  images: string[];
  isPublished: boolean;
  showInNav: boolean;
};

const ALLOWED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

async function uploadPageImage(
  file: File,
): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  if (!ALLOWED_IMAGE_TYPES.includes(file.type))
    return { ok: false, error: "格式不支援（限 JPG/PNG/WebP/GIF）" };
  if (file.size > MAX_IMAGE_BYTES) return { ok: false, error: "圖片超過 5MB" };
  const signed = await requestCourseImageUploadUrl(file.type, "page");
  if (!signed.ok) return { ok: false, error: signed.error };
  const supabase = createClient();
  const { error } = await supabase.storage
    .from(signed.bucket)
    .uploadToSignedUrl(signed.path, signed.token, file, { contentType: file.type });
  if (error) return { ok: false, error: `上傳失敗：${error.message}` };
  return { ok: true, url: signed.publicUrl };
}

function Feedback({ state }: { state: CustomPageFormState }) {
  if (!state) return null;
  return state.error ? (
    <span className="text-sm text-red-600">{state.error}</span>
  ) : state.success ? (
    <span className="text-sm text-green-700">{state.success}</span>
  ) : null;
}

function PageFields({ initial }: { initial?: CustomPageRow }) {
  const [images, setImages] = useState<string[]>(initial?.images ?? []);
  const [imgError, setImgError] = useState("");
  const [uploading, setUploading] = useState(false);

  const onFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    setImgError("");
    setUploading(true);
    for (const file of Array.from(files)) {
      const res = await uploadPageImage(file);
      if (res.ok) setImages((cur) => [...cur, res.url]);
      else setImgError(res.error);
    }
    setUploading(false);
  };

  return (
    <>
      <div className="flex flex-wrap gap-2">
        <input
          name="slug"
          required
          defaultValue={initial?.slug ?? ""}
          placeholder="網址代稱（小寫英數-，例：about-us）"
          className="w-56 rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-black focus:outline-none"
        />
        <input
          name="title"
          required
          defaultValue={initial?.title ?? ""}
          placeholder="頁面標題（顯示於導覽列與頁面）"
          className="w-64 rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-black focus:outline-none"
        />
        <label className="flex items-center gap-1.5 text-sm text-gray-600">
          <input type="checkbox" name="isPublished" defaultChecked={initial?.isPublished ?? true} />
          發佈
        </label>
        <label className="flex items-center gap-1.5 text-sm text-gray-600">
          <input type="checkbox" name="showInNav" defaultChecked={initial?.showInNav ?? true} />
          顯示於導覽列
        </label>
      </div>
      <textarea
        name="content"
        rows={8}
        defaultValue={initial?.content ?? ""}
        placeholder={"頁面內文\n\n空一行分段；網址自動變連結；[按鈕文字](https://網址) 變紅色按鈕；\n**粗體**；## 標題（獨立一段）；---（獨立一段＝分隔線）；![說明](https://圖片網址)（與 EDM 內文同語法）"}
        className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-black focus:outline-none"
      />
      <div className="rounded-lg border border-dashed border-gray-300 p-3">
        <div className="mb-1.5 text-xs font-medium text-gray-500">
          頁面圖片（選填可多張，內文下方依序顯示；JPG/PNG/WebP，各 5MB 內）
        </div>
        {images.map((url) => (
          <input key={url} type="hidden" name="images" value={url} />
        ))}
        <div className="flex flex-wrap items-center gap-3">
          {images.map((url, i) => (
            <div key={url} className="relative">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={url} alt={`圖 ${i + 1}`} className="max-h-28 rounded-lg border border-gray-200" />
              <button
                type="button"
                onClick={() => setImages((cur) => cur.filter((u) => u !== url))}
                className="absolute -right-2 -top-2 rounded-full bg-red-600 px-1.5 text-xs text-white"
                aria-label="移除圖片"
              >
                ✕
              </button>
            </div>
          ))}
          <div className="flex items-center gap-2">
            <input
              type="file"
              multiple
              accept={ALLOWED_IMAGE_TYPES.join(",")}
              onChange={(e) => {
                onFiles(e.target.files);
                e.target.value = "";
              }}
              className="text-sm"
            />
            {uploading && <span className="text-xs text-gray-400">上傳中…</span>}
          </div>
        </div>
        {imgError && <p className="mt-1 text-xs text-red-600">{imgError}</p>}
      </div>
    </>
  );
}

export function CreateCustomPageForm() {
  const [state, action, pending] = useActionState<CustomPageFormState, FormData>(
    createCustomPageAction,
    null,
  );
  return (
    <form action={action} className="space-y-2">
      <PageFields />
      <div className="flex items-center gap-2">
        <button
          disabled={pending}
          className="rounded-lg bg-black px-4 py-2 text-sm font-medium text-white transition hover:bg-gray-800 disabled:opacity-50"
        >
          {pending ? "建立中…" : "建立頁面"}
        </button>
        <Feedback state={state} />
      </div>
    </form>
  );
}

export function CustomPageCard({ page }: { page: CustomPageRow }) {
  const [state, action, pending] = useActionState<CustomPageFormState, FormData>(
    updateCustomPageAction.bind(null, page.id),
    null,
  );
  return (
    <details className="rounded-xl border border-gray-200">
      <summary className="flex cursor-pointer flex-wrap items-center gap-3 px-4 py-3">
        <span className="font-medium">{page.title}</span>
        <span className="font-mono text-xs text-gray-400">/p/{page.slug}</span>
        {!page.isPublished && (
          <span className="rounded-full bg-gray-200 px-2 py-0.5 text-xs text-gray-500">未發佈</span>
        )}
        {page.isPublished && !page.showInNav && (
          <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-700">
            不在導覽列
          </span>
        )}
      </summary>
      <form action={action} className="space-y-2 border-t border-gray-100 px-4 py-3">
        <PageFields initial={page} />
        <div className="flex items-center gap-2">
          <button
            disabled={pending}
            className="rounded-lg border border-gray-400 px-3 py-1.5 text-sm transition hover:bg-gray-100 disabled:opacity-50"
          >
            {pending ? "儲存中…" : "儲存修改"}
          </button>
          <button
            type="button"
            onClick={() => {
              if (confirm(`確定刪除頁面「${page.title}」？此動作無法復原。`))
                deleteCustomPageAction(page.id);
            }}
            className="rounded-lg border border-red-300 px-3 py-1.5 text-sm text-red-600 transition hover:bg-red-50"
          >
            刪除頁面
          </button>
          <a
            href={`/p/${page.slug}`}
            target="_blank"
            className="text-sm text-indigo-600 underline"
          >
            預覽
          </a>
          <Feedback state={state} />
        </div>
      </form>
    </details>
  );
}
