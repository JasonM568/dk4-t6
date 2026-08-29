"use client";

import { useActionState, useState } from "react";
import { requestCourseImageUploadUrl } from "@/actions/admin";
import { updateSignupPageAction, type SignupPageState } from "@/actions/session-signup";
import { createClient } from "@/lib/supabase/client";
import { SubmitButton } from "@/components/admin/submit-button";

const ALLOWED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const INPUT =
  "w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-black focus:outline-none";

/** 場次 DM 圖：瀏覽器直傳 Storage（同課程封面／講座 DM 那套簽名 URL 流程；
 *  bytes 不經過 server action，避開 Vercel ~4.5MB request body 硬上限） */
async function uploadSessionImage(
  file: File,
): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  if (!ALLOWED_IMAGE_TYPES.includes(file.type))
    return { ok: false, error: "格式不支援（限 JPG/PNG/WebP/GIF）" };
  if (file.size > MAX_IMAGE_BYTES) return { ok: false, error: "圖片超過 5MB" };
  const signed = await requestCourseImageUploadUrl(file.type, "session");
  if (!signed.ok) return { ok: false, error: signed.error };
  const supabase = createClient();
  const { error } = await supabase.storage
    .from(signed.bucket)
    .uploadToSignedUrl(signed.path, signed.token, file, { contentType: file.type });
  if (error) return { ok: false, error: `上傳失敗：${error.message}` };
  return { ok: true, url: signed.publicUrl };
}

/** ISO 字串 → datetime-local 需要的台北時間字串（同 webinars-manager 的做法） */
function toTaipeiDatetimeLocal(value: string | null | undefined): string {
  if (!value) return "";
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(value));
  const part = (t: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === t)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}T${part("hour")}:${part("minute")}`;
}

export type SignupPageInitial = {
  signupSlug: string | null;
  isSignupOpen: boolean;
  signupUrl: string | null;
  dmImage: string | null;
  dmImages: string[];
  signupIntro: string | null;
  venue: string | null;
  address: string | null;
  signupOpenAt: string | null;
  signupCloseAt: string | null;
  signupQuota: number | null;
  signupPriceNote: string | null;
  signupPayNote: string | null;
  signupNotice: string | null;
  signupGroupId: string | null;
};

export function SignupPageForm({
  sessionId,
  groups,
  initial,
}: {
  sessionId: string;
  groups: { id: string; name: string }[];
  initial: SignupPageInitial;
}) {
  const [state, formAction] = useActionState<SignupPageState, FormData>(
    updateSignupPageAction.bind(null, sessionId),
    null,
  );
  const [dmImage, setDmImage] = useState(initial.dmImage ?? "");
  const [dmImages, setDmImages] = useState<string[]>(initial.dmImages);
  const [slug, setSlug] = useState(initial.signupSlug ?? "");
  const [signupUrl, setSignupUrl] = useState(initial.signupUrl ?? "");
  const [imgError, setImgError] = useState("");
  const [uploading, setUploading] = useState<"main" | "detail" | null>(null);

  const pickMain = async (file: File | undefined) => {
    if (!file) return;
    setImgError("");
    setUploading("main");
    const res = await uploadSessionImage(file);
    setUploading(null);
    if (res.ok) setDmImage(res.url);
    else setImgError(res.error);
  };

  const pickDetail = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setImgError("");
    setUploading("detail");
    const urls: string[] = [];
    for (const file of Array.from(files)) {
      const res = await uploadSessionImage(file);
      if (res.ok) urls.push(res.url);
      else setImgError(res.error);
    }
    setUploading(null);
    if (urls.length > 0) setDmImages((prev) => [...prev, ...urls]);
  };

  return (
    <form action={formAction} className="space-y-6">
      {state?.error && (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{state.error}</p>
      )}
      {state?.success && (
        <p className="rounded-lg bg-green-50 px-3 py-2 text-sm text-green-700">
          {state.success}
        </p>
      )}

      {/* ── 網址與開關 ── */}
      <section className="space-y-3 rounded-2xl border border-gray-200 p-5">
        <h2 className="text-base font-bold">報名頁網址</h2>
        <label className="block">
          <span className="mb-1 block text-xs text-gray-600">
            網址代稱（小寫英數與連字號）
          </span>
          <input
            name="signupSlug"
            value={slug}
            onChange={(e) => setSlug(e.target.value)}
            placeholder="quantum-2-taipei-0919"
            className={INPUT}
          />
        </label>
        {slug && (
          <p className="text-xs text-gray-500">
            報名頁網址：
            <a
              href={`/event/${slug}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-red-800 underline underline-offset-2"
            >
              /event/{slug}
            </a>
            （EDM 的報名按鈕就填這個網址）
          </p>
        )}
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            name="isSignupOpen"
            defaultChecked={initial.isSignupOpen}
            className="h-4 w-4"
          />
          <span className="font-medium">開放報名</span>
          <span className="text-xs text-gray-500">
            關閉時頁面顯示「未開放報名」，網址仍可訪問
          </span>
        </label>
      </section>

      {/* ── 報名方式 ── */}
      <section className="space-y-3 rounded-2xl border border-gray-200 p-5">
        <h2 className="text-base font-bold">報名方式</h2>
        <label className="block">
          <span className="mb-1 block text-xs text-gray-600">
            外部報名網址（1shop 報名頁）
          </span>
          <input
            name="signupUrl"
            value={signupUrl}
            onChange={(e) => setSignupUrl(e.target.value)}
            placeholder="https://…（留空則使用平台自己的報名表單）"
            className={INPUT}
          />
        </label>
        {signupUrl ? (
          <p className="rounded-lg bg-blue-50 px-3 py-2 text-xs leading-relaxed text-blue-900">
            <strong>目前是「導去 1shop」模式。</strong>
            這一頁只當落地頁：顯示 DM 圖與課程資訊，報名按鈕直接導到上面的網址。
            <br />
            不收表單、不管名額（席次由 1shop 控管），下方的「名額上限」與「繳費方式」不會生效。
            學員在 1shop 下單後，訂單照舊匯入場次看板。
          </p>
        ) : (
          <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs leading-relaxed text-amber-900">
            <strong>目前是「平台報名」模式。</strong>
            學員在這一頁填表，報名先進「待確認」，你收到款項後按「轉入名單」才成為正式名單。
            <br />
            尚未接金流，所以要自己收匯款、自己確認——想省掉這段的話，填上 1shop 報名網址。
          </p>
        )}
      </section>

      {/* ── DM 圖 ── */}
      <section className="space-y-4 rounded-2xl border border-gray-200 p-5">
        <h2 className="text-base font-bold">課程 DM 圖</h2>

        <div className="rounded-lg border border-dashed border-gray-300 p-3">
          <div className="mb-2 text-xs font-medium text-gray-500">
            主視覺（顯示在標題上方，也會用作分享到 LINE／FB 的預覽圖；JPG/PNG/WebP/GIF，5MB 內）
          </div>
          <input type="hidden" name="dmImage" value={dmImage} />
          <div className="flex flex-wrap items-center gap-3">
            {dmImage && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={dmImage}
                alt="DM 主視覺預覽"
                className="max-h-44 rounded-lg border border-gray-200"
              />
            )}
            <div className="flex flex-col gap-2">
              <input
                type="file"
                accept={ALLOWED_IMAGE_TYPES.join(",")}
                disabled={uploading !== null}
                onChange={(e) => pickMain(e.target.files?.[0])}
                className="text-xs"
              />
              {dmImage && (
                <button
                  type="button"
                  onClick={() => setDmImage("")}
                  className="self-start text-xs text-gray-500 underline underline-offset-2"
                >
                  移除主視覺
                </button>
              )}
            </div>
          </div>
        </div>

        <div className="rounded-lg border border-dashed border-gray-300 p-3">
          <div className="mb-2 text-xs font-medium text-gray-500">
            詳情長圖（選填，可多張，依序顯示於課程介紹下方）
          </div>
          {dmImages.map((url) => (
            <input key={url} type="hidden" name="dmImages" value={url} />
          ))}
          {dmImages.length > 0 && (
            <div className="mb-3 flex flex-wrap gap-3">
              {dmImages.map((url) => (
                <div key={url} className="relative">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={url}
                    alt="詳情圖"
                    className="max-h-32 rounded-lg border border-gray-200"
                  />
                  <button
                    type="button"
                    onClick={() => setDmImages((prev) => prev.filter((u) => u !== url))}
                    className="absolute right-1 top-1 rounded-full bg-black/60 px-2 text-xs text-white"
                    aria-label="移除這張圖"
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          )}
          <input
            type="file"
            multiple
            accept={ALLOWED_IMAGE_TYPES.join(",")}
            disabled={uploading !== null}
            onChange={(e) => pickDetail(e.target.files)}
            className="text-xs"
          />
        </div>

        {uploading && <p className="text-xs text-gray-500">上傳中…</p>}
        {imgError && <p className="text-xs text-red-600">🖼️ {imgError}</p>}
      </section>

      {/* ── 課程資訊 ── */}
      <section className="space-y-3 rounded-2xl border border-gray-200 p-5">
        <h2 className="text-base font-bold">課程資訊</h2>
        <label className="block">
          <span className="mb-1 block text-xs text-gray-600">課程介紹（純文字，換行會保留）</span>
          <textarea
            name="signupIntro"
            rows={6}
            maxLength={5000}
            defaultValue={initial.signupIntro ?? ""}
            className={`${INPUT} resize-y`}
          />
        </label>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block">
            <span className="mb-1 block text-xs text-gray-600">場地名稱</span>
            <input
              name="venue"
              defaultValue={initial.venue ?? ""}
              placeholder="台北市青少年發展處 5F"
              className={INPUT}
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs text-gray-600">地址（前台會附地圖連結）</span>
            <input
              name="address"
              defaultValue={initial.address ?? ""}
              placeholder="台北市中正區仁愛路一段17號"
              className={INPUT}
            />
          </label>
        </div>
        <label className="block">
          <span className="mb-1 block text-xs text-gray-600">費用說明</span>
          <input
            name="signupPriceNote"
            defaultValue={initial.signupPriceNote ?? ""}
            placeholder="早鳥價 3,800 元（8/31 前）／原價 4,500 元"
            className={INPUT}
          />
        </label>
      </section>

      {/* ── 報名條件 ── */}
      <section className="space-y-3 rounded-2xl border border-gray-200 p-5">
        <h2 className="text-base font-bold">報名條件</h2>
        <div className="grid gap-3 sm:grid-cols-3">
          <label className="block">
            <span className="mb-1 block text-xs text-gray-600">報名開始（選填）</span>
            <input
              type="datetime-local"
              name="signupOpenAt"
              defaultValue={toTaipeiDatetimeLocal(initial.signupOpenAt)}
              className={INPUT}
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs text-gray-600">報名截止（選填）</span>
            <input
              type="datetime-local"
              name="signupCloseAt"
              defaultValue={toTaipeiDatetimeLocal(initial.signupCloseAt)}
              className={INPUT}
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs text-gray-600">名額上限（留空不限）</span>
            <input
              type="number"
              min={1}
              name="signupQuota"
              defaultValue={initial.signupQuota ?? ""}
              className={INPUT}
            />
          </label>
        </div>
        <p className="text-xs text-gray-500">
          沒填截止時間的話，過了開課日（台北時間隔天）會自動關閉報名。
          名額以「正式名單＋待確認」合計計算。
        </p>
        <label className="block">
          <span className="mb-1 block text-xs text-gray-600">
            報名成功自動加入名單群組（選填，之後寄 EDM 用）
          </span>
          <select name="signupGroupId" defaultValue={initial.signupGroupId ?? ""} className={INPUT}>
            <option value="">不加入名單</option>
            {groups.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </select>
        </label>
      </section>

      {/* ── 繳費與注意事項 ── */}
      <section className="space-y-3 rounded-2xl border border-gray-200 p-5">
        <h2 className="text-base font-bold">繳費與注意事項</h2>
        <label className="block">
          <span className="mb-1 block text-xs text-gray-600">
            繳費方式（會一併寫進報名確認信）
          </span>
          <textarea
            name="signupPayNote"
            rows={5}
            maxLength={3000}
            defaultValue={initial.signupPayNote ?? ""}
            placeholder={"匯款帳號：○○銀行（代號 000）000-000-000000\n戶名：○○○\n匯款後請回信告知後五碼，我們確認後回覆報名成功。"}
            className={`${INPUT} resize-y`}
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs text-gray-600">注意事項／退費政策</span>
          <textarea
            name="signupNotice"
            rows={4}
            maxLength={3000}
            defaultValue={initial.signupNotice ?? ""}
            className={`${INPUT} resize-y`}
          />
        </label>
      </section>

      <SubmitButton className="rounded-xl bg-black px-5 py-2.5 text-sm font-medium text-white transition hover:bg-gray-800">
        儲存報名頁設定
      </SubmitButton>
    </form>
  );
}
