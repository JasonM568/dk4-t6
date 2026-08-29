"use client";

import { useRef, useState } from "react";
import { youTubeThumbnailUrl, youTubeVideoId } from "@/lib/video-embed";
import { MAX_DM_BLOCKS, moveBlock, type DmBlock } from "@/lib/session-signup-page";

/** 課程詳情區塊編輯器：圖片與影片混排，順序即前台顯示順序。
 *
 *  排序同時給「拖曳」與「↑↓ 按鈕」兩種操作——原生 HTML5 拖放在手機上等於沒有，
 *  而後台常常是在手機上臨時改；只做拖曳會有人改不動。 */
export function DmBlocksEditor({
  blocks,
  onChange,
  onUpload,
  uploading,
}: {
  blocks: DmBlock[];
  onChange: (next: DmBlock[]) => void;
  /** 回傳上傳後的公開網址；失敗回 null（錯誤訊息由父層顯示） */
  onUpload: (files: File[]) => Promise<string[]>;
  uploading: boolean;
}) {
  const [videoUrl, setVideoUrl] = useState("");
  const [videoError, setVideoError] = useState("");
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  const [dragOver, setDragOver] = useState<number | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const move = (from: number, to: number) => onChange(moveBlock(blocks, from, to));

  const remove = (i: number) => onChange(blocks.filter((_, idx) => idx !== i));

  const addVideo = () => {
    const url = videoUrl.trim();
    setVideoError("");
    if (!url) return;
    if (!/^https?:\/\//.test(url)) {
      setVideoError("請貼完整網址（https:// 開頭）");
      return;
    }
    // 不是 YouTube 就當影片檔直連（mp4/webm）——前台用 <video> 播，
    // 但 CSP 的 media-src 只放行 Supabase，外部檔案會被擋，先擋在這裡講清楚
    if (!youTubeVideoId(url) && !/\.(mp4|webm)(\?|$)/i.test(url)) {
      setVideoError("目前支援 YouTube 連結，或已上傳到本站的 .mp4／.webm 影片檔網址");
      return;
    }
    if (blocks.length >= MAX_DM_BLOCKS) {
      setVideoError(`區塊最多 ${MAX_DM_BLOCKS} 個`);
      return;
    }
    onChange([...blocks, { type: "video", url }]);
    setVideoUrl("");
  };

  const pickFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const urls = await onUpload(Array.from(files));
    if (urls.length > 0) {
      onChange([...blocks, ...urls.map((url) => ({ type: "image" as const, url }))]);
    }
    // 清掉 input 的值：不清的話「再選同一批檔案」不會觸發 change 事件，
    // 使用者會覺得「上傳過一次就不能再上傳了」
    if (fileRef.current) fileRef.current.value = "";
  };

  return (
    <div className="space-y-3">
      <input type="hidden" name="dmBlocks" value={JSON.stringify(blocks)} />

      {blocks.length === 0 ? (
        <p className="rounded-lg border border-dashed border-gray-300 px-4 py-6 text-center text-xs text-gray-500">
          還沒有內容。用下面的按鈕加入圖片或影片，加入後可以拖曳調整順序。
        </p>
      ) : (
        <ul className="space-y-2">
          {blocks.map((b, i) => (
            <li
              key={`${b.type}-${b.url}-${i}`}
              draggable
              onDragStart={() => setDragFrom(i)}
              onDragOver={(e) => {
                e.preventDefault();
                setDragOver(i);
              }}
              onDragEnd={() => {
                setDragFrom(null);
                setDragOver(null);
              }}
              onDrop={(e) => {
                e.preventDefault();
                if (dragFrom !== null) move(dragFrom, i);
                setDragFrom(null);
                setDragOver(null);
              }}
              className={`flex items-center gap-3 rounded-xl border bg-white p-2.5 transition ${
                dragOver === i && dragFrom !== null && dragFrom !== i
                  ? "border-indigo-400 bg-indigo-50"
                  : "border-gray-200"
              } ${dragFrom === i ? "opacity-40" : ""}`}
            >
              <span
                className="cursor-grab select-none px-1 text-lg text-gray-400"
                title="拖曳調整順序"
                aria-hidden="true"
              >
                ⠿
              </span>
              <span className="w-6 shrink-0 text-center text-xs font-medium text-gray-400">
                {i + 1}
              </span>

              <BlockThumb block={b} />

              <div className="min-w-0 flex-1">
                <span
                  className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${
                    b.type === "video"
                      ? "bg-rose-100 text-rose-700"
                      : "bg-sky-100 text-sky-700"
                  }`}
                >
                  {b.type === "video" ? "▶ 影片" : "🖼 圖片"}
                </span>
                <p className="mt-1 truncate text-xs text-gray-500" title={b.url}>
                  {b.url}
                </p>
              </div>

              <div className="flex shrink-0 items-center gap-1">
                <button
                  type="button"
                  onClick={() => move(i, i - 1)}
                  disabled={i === 0}
                  title="上移"
                  className="rounded border border-gray-300 px-2 py-1 text-xs transition hover:bg-gray-50 disabled:opacity-30"
                >
                  ↑
                </button>
                <button
                  type="button"
                  onClick={() => move(i, i + 1)}
                  disabled={i === blocks.length - 1}
                  title="下移"
                  className="rounded border border-gray-300 px-2 py-1 text-xs transition hover:bg-gray-50 disabled:opacity-30"
                >
                  ↓
                </button>
                <button
                  type="button"
                  onClick={() => remove(i)}
                  title="移除"
                  className="rounded border border-gray-300 px-2 py-1 text-xs text-red-600 transition hover:bg-red-50"
                >
                  ✕
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-dashed border-gray-300 p-3">
        <input
          ref={fileRef}
          type="file"
          multiple
          accept="image/jpeg,image/png,image/webp,image/gif"
          disabled={uploading || blocks.length >= MAX_DM_BLOCKS}
          onChange={(e) => pickFiles(e.target.files)}
          className="text-xs"
        />
        <span className="text-xs text-gray-500">
          {uploading ? "上傳中…" : "可一次選多張，也可以分次加"}
        </span>
      </div>

      <div className="rounded-xl border border-dashed border-gray-300 p-3">
        <div className="flex flex-wrap gap-2">
          <input
            type="url"
            value={videoUrl}
            onChange={(e) => setVideoUrl(e.target.value)}
            onKeyDown={(e) => {
              // 表單裡按 Enter 預設會送出整張表單，這裡攔下來當「加入影片」
              if (e.key === "Enter") {
                e.preventDefault();
                addVideo();
              }
            }}
            placeholder="貼上 YouTube 連結（Shorts 也可以）"
            className="min-w-0 flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-black focus:outline-none"
          />
          <button
            type="button"
            onClick={addVideo}
            disabled={blocks.length >= MAX_DM_BLOCKS}
            className="rounded-lg border border-gray-400 px-3 py-2 text-sm transition hover:bg-gray-50 disabled:opacity-40"
          >
            ＋ 加入影片
          </button>
        </div>
        {videoError && <p className="mt-1 text-xs text-red-600">{videoError}</p>}
      </div>

      {blocks.length >= MAX_DM_BLOCKS && (
        <p className="text-xs text-amber-700">已達上限 {MAX_DM_BLOCKS} 個區塊。</p>
      )}
    </div>
  );
}

function BlockThumb({ block }: { block: DmBlock }) {
  const thumb = block.type === "video" ? youTubeThumbnailUrl(block.url) : block.url;
  if (!thumb) {
    return (
      <span className="flex h-12 w-20 shrink-0 items-center justify-center rounded-lg bg-gray-800 text-lg text-white">
        ▶
      </span>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={thumb}
      alt=""
      className="h-12 w-20 shrink-0 rounded-lg border border-gray-200 object-cover"
    />
  );
}
