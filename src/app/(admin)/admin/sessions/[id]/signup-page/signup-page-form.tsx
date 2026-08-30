"use client";

import { useActionState, useState } from "react";
import { requestCourseImageUploadUrl } from "@/actions/admin";
import { updateSignupPageAction, type SignupPageState } from "@/actions/session-signup";
import { createClient } from "@/lib/supabase/client";
import { SubmitButton } from "@/components/admin/submit-button";
import { type DmBlock } from "@/lib/session-signup-page";
import { DmBlocksEditor } from "./dm-blocks-editor";

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
  signupCtaLabel: string | null;
  signupPayMode: string; // EXTERNAL / PLATFORM / MANUAL
  signupPrice: number | null;
  signupListPrice: number | null;
  signupRetrainPrice: number | null;
  signupRetrainCourseIds: string[];
  dmImage: string | null;
  dmBlocks: DmBlock[];
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
  canonicalCourses,
  initial,
}: {
  sessionId: string;
  groups: { id: string; name: string }[];
  canonicalCourses: { id: string; name: string; kind: string }[];
  initial: SignupPageInitial;
}) {
  const [state, formAction] = useActionState<SignupPageState, FormData>(
    updateSignupPageAction.bind(null, sessionId),
    null,
  );
  const [dmImage, setDmImage] = useState(initial.dmImage ?? "");
  const [blocks, setBlocks] = useState<DmBlock[]>(initial.dmBlocks);
  const [slug, setSlug] = useState(initial.signupSlug ?? "");
  const [signupUrl, setSignupUrl] = useState(initial.signupUrl ?? "");
  const [payMode, setPayMode] = useState(initial.signupPayMode || "MANUAL");
  const [ctaLabel, setCtaLabel] = useState(initial.signupCtaLabel ?? "");
  const [price, setPrice] = useState(initial.signupPrice?.toString() ?? "");
  const [listPrice, setListPrice] = useState(initial.signupListPrice?.toString() ?? "");
  const [retrainPrice, setRetrainPrice] = useState(initial.signupRetrainPrice?.toString() ?? "");
  const [retrainCourseIds, setRetrainCourseIds] = useState<Set<string>>(
    new Set(initial.signupRetrainCourseIds),
  );
  const toggleRetrainCourse = (id: string) =>
    setRetrainCourseIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
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

  /** 詳情區塊的圖片上傳：回傳成功的網址，區塊順序交給 DmBlocksEditor 管 */
  const uploadMany = async (files: File[]): Promise<string[]> => {
    setImgError("");
    setUploading("detail");
    const urls: string[] = [];
    for (const file of files) {
      const res = await uploadSessionImage(file);
      if (res.ok) urls.push(res.url);
      else setImgError(res.error);
    }
    setUploading(null);
    return urls;
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
          {/* 存檔時一律轉小寫，所以打字當下就轉——不然畫面顯示的連結會跟實際存的
              網址對不上，複製出去就是 404（Q2-taipei-0919 事件） */}
          <input
            name="signupSlug"
            value={slug}
            onChange={(e) => setSlug(e.target.value.toLowerCase())}
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
            （EDM 的報名按鈕就填這個網址；代稱一律小寫）
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
        <input type="hidden" name="signupPayMode" value={payMode} />
        {/* 模式切換不弄丟設定：未顯示區塊的欄位用隱藏欄位照樣送出，儲存永遠帶全部值。
            沒有這段的話，切去別的模式再儲存，看不見的欄位會被存成空（外部連結要重打）。 */}
        {payMode !== "EXTERNAL" && (
          <>
            <input type="hidden" name="signupUrl" value={signupUrl} />
            <input type="hidden" name="signupCtaLabel" value={ctaLabel} />
          </>
        )}
        {payMode !== "PLATFORM" && (
          <>
            <input type="hidden" name="signupPrice" value={price} />
            <input type="hidden" name="signupListPrice" value={listPrice} />
            <input type="hidden" name="signupRetrainPrice" value={retrainPrice} />
            {[...retrainCourseIds].map((id) => (
              <input key={id} type="hidden" name="signupRetrainCourseIds" value={id} />
            ))}
          </>
        )}
        <div className="space-y-2 text-sm">
          {[
            { v: "PLATFORM", t: "平台線上金流（刷卡＋ATM）", d: "學員在這頁填表→線上付款，付款完成自動進正式名單並開立電子發票。" },
            { v: "EXTERNAL", t: "導去外部報名頁（1shop）", d: "這頁只當落地頁，報名按鈕導去 1shop 填表付款；席次由對方控管。" },
            { v: "MANUAL", t: "平台表單手動收款", d: "填表後進「待確認」，你收到匯款後按「轉入名單」才成正式名單。" },
          ].map((o) => (
            <label
              key={o.v}
              className={`flex cursor-pointer gap-2 rounded-lg border px-3 py-2 ${
                payMode === o.v ? "border-black bg-gray-50" : "border-gray-200"
              }`}
            >
              <input
                type="radio"
                name="signupPayModeRadio"
                checked={payMode === o.v}
                onChange={() => setPayMode(o.v)}
                className="mt-0.5"
              />
              <span>
                <span className="font-medium">{o.t}</span>
                <span className="mt-0.5 block text-xs text-gray-500">{o.d}</span>
              </span>
            </label>
          ))}
        </div>

        {payMode === "PLATFORM" && (
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block">
              <span className="mb-1 block text-xs text-gray-600">
                每人報名費用＝特價（NT$，實收）<span className="text-red-600">*</span>
              </span>
              <input
                type="number"
                min={1}
                name="signupPrice"
                value={price}
                onChange={(e) => setPrice(e.target.value)}
                placeholder="例：5880"
                className={INPUT}
              />
              <span className="mt-1 block text-xs text-gray-500">
                新生／一般實收價。多人報名時金額逐位加總。開放刷卡與 ATM。
              </span>
            </label>
            <label className="block">
              <span className="mb-1 block text-xs text-gray-600">原價（選填，顯示用）</span>
              <input
                type="number"
                min={1}
                name="signupListPrice"
                value={listPrice}
                onChange={(e) => setListPrice(e.target.value)}
                placeholder="例：8880"
                className={INPUT}
              />
              <span className="mt-1 block text-xs text-gray-500">
                報名頁會顯示「原價劃線 → 特價」；留空則只顯示一個價格。不影響實收。
              </span>
            </label>
          </div>
        )}

        {payMode === "PLATFORM" && (
          <div className="space-y-2 rounded-lg border border-gray-200 bg-gray-50/60 p-3">
            <p className="text-xs font-medium text-gray-700">
              自動新舊生定價（選填）
            </p>
            <p className="text-xs text-gray-500">
              報名時用手機／email 查學員上課史，上過下方任一課程＝舊生套「複訓價」，否則套新生價。
              留空複訓價＝不分新舊生，一律新生價。
            </p>
            <label className="block">
              <span className="mb-1 block text-xs text-gray-600">複訓價（NT$，整數）</span>
              <input
                type="number"
                min={0}
                name="signupRetrainPrice"
                value={retrainPrice}
                onChange={(e) => setRetrainPrice(e.target.value)}
                placeholder="例：2380"
                className={INPUT}
              />
            </label>
            <div>
              <span className="mb-1 block text-xs text-gray-600">
                複訓資格課程（勾選「上過就算舊生」的標準課程）
              </span>
              {canonicalCourses.length === 0 ? (
                <p className="text-xs text-gray-400">
                  尚無標準課程可選（請先到「學員 → 課名歸戶」建立）
                </p>
              ) : (
                <div className="grid max-h-56 grid-cols-1 gap-1 overflow-y-auto rounded-lg border border-gray-200 bg-white p-2 sm:grid-cols-2">
                  {canonicalCourses.map((c) => (
                    <label key={c.id} className="flex items-center gap-2 text-xs">
                      <input
                        type="checkbox"
                        name="signupRetrainCourseIds"
                        value={c.id}
                        checked={retrainCourseIds.has(c.id)}
                        onChange={() => toggleRetrainCourse(c.id)}
                        className="h-3.5 w-3.5"
                      />
                      <span>{c.name}</span>
                    </label>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {payMode === "EXTERNAL" && (
          <div className="space-y-3">
            <label className="block">
              <span className="mb-1 block text-xs text-gray-600">
                外部報名網址（1shop 報名頁）<span className="text-red-600">*</span>
              </span>
              <input
                name="signupUrl"
                value={signupUrl}
                onChange={(e) => setSignupUrl(e.target.value)}
                placeholder="https://…"
                className={INPUT}
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs text-gray-600">
                按鈕文字（選填，留空顯示「立即報名」）
              </span>
              <input
                name="signupCtaLabel"
                maxLength={30}
                value={ctaLabel}
                onChange={(e) => setCtaLabel(e.target.value)}
                placeholder="例：前往查看課程介紹"
                className={INPUT}
              />
            </label>
          </div>
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

        <div>
          <div className="mb-2 text-xs font-medium text-gray-500">
            課程詳情（選填）——圖片與影片可混排，順序就是前台顯示的順序，
            拖曳 ⠿ 或按 ↑↓ 調整。例：第一格放影片、後面接多張圖。
          </div>
          <DmBlocksEditor
            blocks={blocks}
            onChange={setBlocks}
            onUpload={uploadMany}
            uploading={uploading === "detail"}
          />
        </div>

        {uploading === "main" && <p className="text-xs text-gray-500">上傳中…</p>}
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
