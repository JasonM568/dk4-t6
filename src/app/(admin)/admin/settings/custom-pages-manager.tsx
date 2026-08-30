"use client";

import { useActionState, useRef, useState } from "react";
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
  videoUrl: string | null;
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

/** 內文起手範本：空白欄位最難下手，給幾個現成骨架直接改。 */
const CONTENT_TEMPLATES: { name: string; hint: string; body: string }[] = [
  {
    name: "🎬 短影片行銷頁",
    hint: "EDM／簡訊導流用：影片＋一句話＋軟性 CTA",
    body: `還記得課堂上的感覺嗎？

這支片段來自最近一場課程——先看看，回味一下。

---

看完想了解更多？完整課程資訊在這裡：

[查看課程資訊](https://course.huangxi.info/event/代稱)`,
  },
  {
    name: "📣 活動落地頁",
    hint: "課程／活動介紹＋報名按鈕",
    body: `## 這堂課要解決什麼問題

用兩三句話說清楚學員的痛點，以及上完課會帶走什麼。

## 課程資訊

- 日期：2026/00/00（六）10:00–17:30
- 地點：台北市中山區松江路101號4樓
- 費用：早鳥價 0,000 元

## 適合誰

- 條列第一種人
- 條列第二種人

[立即報名](https://course.huangxi.info/event/代稱)`,
  },
  {
    name: "📄 圖文介紹頁",
    hint: "純內容：標題＋段落＋圖片",
    body: `## 標題一

第一段內容。空一行就會分段。

## 標題二

第二段內容，**重點可以用粗體**。

![圖片說明](https://圖片網址)`,
  },
];

function PageFields({ initial }: { initial?: CustomPageRow }) {
  const [images, setImages] = useState<string[]>(initial?.images ?? []);
  const [imgError, setImgError] = useState("");
  const [uploading, setUploading] = useState(false);
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const [bodyImgError, setBodyImgError] = useState("");
  const [bodyImgUploading, setBodyImgUploading] = useState(false);
  const bodyImgRef = useRef<HTMLInputElement>(null);

  // 把語法片段插進游標處；selectRange 會選取佔位文字，打字即取代（同 EDM 工具列）
  const insertSnippet = (snippet: string, selectRange?: [number, number]) => {
    const el = bodyRef.current;
    if (!el) return;
    const start = el.selectionStart ?? el.value.length;
    const end = el.selectionEnd ?? el.value.length;
    el.value = el.value.slice(0, start) + snippet + el.value.slice(end);
    el.focus();
    if (selectRange) {
      el.setSelectionRange(start + selectRange[0], start + selectRange[1]);
    } else {
      const pos = start + snippet.length;
      el.setSelectionRange(pos, pos);
    }
  };

  const wrapBold = () => {
    const el = bodyRef.current;
    if (!el) return;
    const start = el.selectionStart ?? 0;
    const end = el.selectionEnd ?? 0;
    if (end > start) {
      const sel = el.value.slice(start, end);
      el.value = `${el.value.slice(0, start)}**${sel}**${el.value.slice(end)}`;
      el.focus();
      el.setSelectionRange(end + 4, end + 4);
    } else {
      insertSnippet("**粗體文字**", [2, 6]);
    }
  };

  /** 套用範本：內文空的直接填入；有內容則附加在後面（不覆蓋既有心血） */
  const applyTemplate = (body: string) => {
    const el = bodyRef.current;
    if (!el) return;
    el.value = el.value.trim() ? `${el.value.trim()}\n\n${body}` : body;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
  };

  const onBodyImagePicked = async (file: File | null) => {
    if (!file) return;
    setBodyImgUploading(true);
    setBodyImgError("");
    const res = await uploadPageImage(file);
    setBodyImgUploading(false);
    if (bodyImgRef.current) bodyImgRef.current.value = "";
    if (!res.ok) {
      setBodyImgError(res.error);
      return;
    }
    insertSnippet(`\n\n![圖片說明](${res.url})\n\n`);
  };

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
      <input
        name="videoUrl"
        defaultValue={initial?.videoUrl ?? ""}
        placeholder="影片網址（選填）：貼 YouTube 連結（含 Shorts）或影片檔網址，顯示在標題下方——短影片行銷頁用，看過的人會被 Pixel 記成受眾"
        className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-black focus:outline-none"
      />
      {/* 起手範本：空白欄位最難下手，點一下帶入骨架再改文字 */}
      <div className="rounded-lg border border-dashed border-gray-300 p-3">
        <div className="mb-2 text-xs font-medium text-gray-500">
          不知道怎麼開始？點一個範本帶入內文骨架（已有內容會接在後面，不會覆蓋）
        </div>
        <div className="flex flex-wrap gap-2">
          {CONTENT_TEMPLATES.map((t) => (
            <button
              key={t.name}
              type="button"
              onClick={() => applyTemplate(t.body)}
              title={t.hint}
              className="rounded-lg border border-gray-300 px-3 py-1.5 text-xs transition hover:bg-gray-100"
            >
              {t.name}
            </button>
          ))}
        </div>
      </div>

      {/* 內文工具列（同 EDM）：點按鈕插入語法，不用背 */}
      <div className="flex flex-wrap items-center gap-1.5 rounded-t-lg border border-b-0 border-gray-300 bg-gray-50 px-2 py-1.5">
        <button
          type="button"
          onClick={wrapBold}
          title="粗體：選取文字後點擊，或點擊後直接輸入"
          className="rounded border border-gray-300 bg-white px-2 py-1 text-xs font-bold transition hover:bg-gray-100"
        >
          B 粗體
        </button>
        <button
          type="button"
          onClick={() => insertSnippet("\n\n## 標題文字\n\n", [4, 8])}
          title="插入標題（一行大字）"
          className="rounded border border-gray-300 bg-white px-2 py-1 text-xs transition hover:bg-gray-100"
        >
          ## 標題
        </button>
        <button
          type="button"
          onClick={() => insertSnippet("\n\n---\n\n")}
          title="插入分隔線"
          className="rounded border border-gray-300 bg-white px-2 py-1 text-xs transition hover:bg-gray-100"
        >
          ─ 分隔線
        </button>
        <button
          type="button"
          onClick={() => insertSnippet("\n\n[按鈕文字](https://網址)\n\n", [3, 7])}
          title="插入紅色 CTA 按鈕"
          className="rounded border border-gray-300 bg-white px-2 py-1 text-xs transition hover:bg-gray-100"
        >
          🔘 按鈕
        </button>
        <button
          type="button"
          onClick={() => bodyImgRef.current?.click()}
          disabled={bodyImgUploading}
          title="上傳圖片並插入內文（JPG/PNG/WebP/GIF，5MB 內）"
          className="rounded border border-gray-300 bg-white px-2 py-1 text-xs transition hover:bg-gray-100 disabled:opacity-50"
        >
          {bodyImgUploading ? "上傳中…" : "🖼️ 插入圖片"}
        </button>
        <input
          ref={bodyImgRef}
          type="file"
          accept={ALLOWED_IMAGE_TYPES.join(",")}
          onChange={(e) => onBodyImagePicked(e.target.files?.[0] ?? null)}
          className="hidden"
        />
        {bodyImgError && <span className="text-xs text-red-600">{bodyImgError}</span>}
      </div>
      {/* -mt-2 抵銷父層 space-y-2 的間距，讓工具列與輸入框貼合成一體 */}
      <textarea
        ref={bodyRef}
        name="content"
        rows={10}
        defaultValue={initial?.content ?? ""}
        placeholder={"頁面內文——可先點上方範本帶入骨架\n\n空一行分段；網址自動變連結；[按鈕文字](https://網址) 變紅色按鈕；\n**粗體**；## 標題（獨立一段）；---（獨立一段＝分隔線）；![說明](https://圖片網址)（與 EDM 內文同語法）"}
        className="-mt-2 w-full rounded-b-lg rounded-t-none border border-gray-300 px-3 py-2 text-sm focus:border-black focus:outline-none"
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
