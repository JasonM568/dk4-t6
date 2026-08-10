"use client";

import { useActionState, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { requestCourseImageUploadUrl } from "@/actions/admin";
import { createTodayDailyBrief, deleteDailyBrief, updateDailyBrief, type DailyBriefFormState } from "@/actions/daily-briefs";

type Brief = { id: string; dateKey: string; title: string; status: string; coverVariant: number; images: string[] };
const allowed = ["image/jpeg", "image/png", "image/webp", "image/gif"];
const maxBytes = 5 * 1024 * 1024;

async function upload(file: File): Promise<{ url?: string; error?: string }> {
  if (!allowed.includes(file.type)) return { error: "格式限 JPG、PNG、WebP、GIF" };
  if (file.size > maxBytes) return { error: "單張圖片不可超過 5MB" };
  const signed = await requestCourseImageUploadUrl(file.type, "brief");
  if (!signed.ok) return { error: signed.error };
  const { error } = await createClient().storage.from(signed.bucket).uploadToSignedUrl(signed.path, signed.token, file, { contentType: file.type });
  return error ? { error: `上傳失敗：${error.message}` } : { url: signed.publicUrl };
}

function ImageFields({ initial = [] }: { initial?: string[] }) {
  const [images, setImages] = useState(initial);
  const [message, setMessage] = useState("");
  const [uploading, setUploading] = useState(false);
  const select = async (files: FileList | null) => {
    if (!files?.length) return;
    setUploading(true); setMessage("");
    for (const file of Array.from(files)) {
      const result = await upload(file);
      if (result.url) {
        const imageUrl = result.url;
        setImages((current) => [...current, imageUrl]);
      }
      else setMessage(result.error ?? "上傳失敗");
    }
    setUploading(false);
  };
  return <div className="rounded-lg border border-dashed border-gray-300 p-3">
    <div className="mb-2 text-xs text-gray-500">新聞截圖（拖曳排序以決定閱讀順序）</div>
    {images.map((url, index) => <input key={url} type="hidden" name="images" value={url} />)}
    <div className="flex flex-wrap gap-2">
      {images.map((url, index) => <div key={url} className="relative">
        {/* eslint-disable-next-line @next/next/no-img-element */}<img src={url} alt={`剪報 ${index + 1}`} className="h-20 w-20 rounded object-cover" />
        <div className="absolute bottom-0 left-0 right-0 flex justify-between bg-black/60 px-1 text-xs text-white">
          <button type="button" disabled={index === 0} onClick={() => setImages((v) => { const n=[...v]; [n[index-1],n[index]]=[n[index],n[index-1]]; return n; })}>←</button>
          <button type="button" onClick={() => setImages((v) => v.filter((item) => item !== url))}>×</button>
          <button type="button" disabled={index === images.length-1} onClick={() => setImages((v) => { const n=[...v]; [n[index+1],n[index]]=[n[index],n[index+1]]; return n; })}>→</button>
        </div>
      </div>)}
      <label className="flex h-20 w-20 cursor-pointer items-center justify-center rounded border border-dashed border-gray-300 text-center text-xs text-gray-500 hover:bg-gray-50">
        <span>{uploading ? "上傳中…" : "＋新增圖片"}</span><input className="hidden" type="file" accept={allowed.join(",")} multiple onChange={(event) => { select(event.target.files); event.target.value = ""; }} />
      </label>
    </div>
    {message && <p className="mt-2 text-xs text-red-600">{message}</p>}
  </div>;
}

function Feedback({ state }: { state: DailyBriefFormState }) { return state?.error ? <p className="text-sm text-red-600">{state.error}</p> : state?.success ? <p className="text-sm text-green-700">{state.success}</p> : null; }

function TodayForm({ groupId, groupSlug }: { groupId: string; groupSlug: string }) {
  const [state, action, pending] = useActionState<DailyBriefFormState, FormData>(createTodayDailyBrief.bind(null, groupId, groupSlug), null);
  return <form action={action} className="space-y-3 rounded-xl border border-indigo-200 bg-indigo-50/50 p-4"><div><h2 className="font-semibold">發布今日剪報</h2><p className="mt-1 text-xs text-gray-500">系統會自動帶入今天日期與「每日財經剪報」標題，並立即發佈給訂閱會員。</p></div><ImageFields /><button disabled={pending} className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">{pending ? "發布中…" : "上傳並發布今日剪報"}</button><Feedback state={state} /></form>;
}

function BriefCard({ brief, groupSlug }: { brief: Brief; groupSlug: string }) {
  const [state, action, pending] = useActionState<DailyBriefFormState, FormData>(updateDailyBrief.bind(null, brief.id, groupSlug), null);
  return <details className="rounded-xl border border-gray-200"><summary className="cursor-pointer px-4 py-3"><span className="font-medium">{brief.title}</span><span className="ml-2 rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-600">{brief.status === "PUBLISHED" ? "已發布" : brief.status === "DRAFT" ? "草稿" : "已下架"}</span><span className="ml-2 text-xs text-gray-400">{brief.images.length} 張截圖</span></summary><form action={action} className="space-y-3 border-t border-gray-100 p-4"><input name="title" defaultValue={brief.title} className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" /><select name="status" defaultValue={brief.status} className="rounded-lg border border-gray-300 px-3 py-2 text-sm"><option value="PUBLISHED">發布</option><option value="DRAFT">草稿</option><option value="UNPUBLISHED">下架</option></select><ImageFields initial={brief.images} /><div className="flex items-center gap-3"><button disabled={pending} className="rounded-lg border border-gray-400 px-3 py-1.5 text-sm disabled:opacity-50">{pending ? "儲存中…" : "儲存修改"}</button><button type="button" onClick={() => { if (confirm(`確定刪除 ${brief.title}？`)) deleteDailyBrief(brief.id, groupSlug); }} className="text-sm text-red-600 hover:underline">刪除</button><Feedback state={state} /></div></form></details>;
}

export function DailyBriefsManager({ groupId, groupSlug, briefs }: { groupId: string; groupSlug: string; briefs: Brief[] }) { return <div className="space-y-5"><TodayForm groupId={groupId} groupSlug={groupSlug} /><section><h2 className="mb-3 text-lg font-bold">歷史剪報</h2><div className="space-y-3">{briefs.length ? briefs.map((brief) => <BriefCard key={brief.id} brief={brief} groupSlug={groupSlug} />) : <p className="text-sm text-gray-400">尚未發布剪報。</p>}</div></section></div>; }
