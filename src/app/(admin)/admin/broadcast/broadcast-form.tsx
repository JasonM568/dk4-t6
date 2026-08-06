"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useActionState } from "react";
import Link from "next/link";
import {
  previewGroupAudienceAction,
  requestCourseImageUploadUrl,
  saveBroadcastListToGroupAction,
  type BroadcastState,
} from "@/actions/admin";
import type { GroupAudiencePreview } from "@/lib/email/audience";
import { SubmitButton } from "@/components/admin/submit-button";
import { createClient } from "@/lib/supabase/client";
import { applyMergeTags, buildContentHtml } from "@/lib/email/render-content";

const ALLOWED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

/** 內文圖片：瀏覽器直傳 Storage（同課程封面／自訂頁那套簽名 URL 流程） */
async function uploadBodyImage(
  file: File,
): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  if (!ALLOWED_IMAGE_TYPES.includes(file.type))
    return { ok: false, error: "格式不支援（限 JPG/PNG/WebP/GIF）" };
  if (file.size > MAX_IMAGE_BYTES) return { ok: false, error: "圖片超過 5MB" };
  const signed = await requestCourseImageUploadUrl(file.type, "broadcast");
  if (!signed.ok) return { ok: false, error: signed.error };
  const supabase = createClient();
  const { error } = await supabase.storage
    .from(signed.bucket)
    .uploadToSignedUrl(signed.path, signed.token, file, { contentType: file.type });
  if (error) return { ok: false, error: `上傳失敗：${error.message}` };
  return { ok: true, url: signed.publicUrl };
}

type GroupOption = { id: string; name: string; memberCount: number };
type MemberOption = { email: string; name: string };

export type BroadcastFormDefaults = {
  subject: string;
  body: string;
  courseId: string;
  audience: "all" | "group" | "manual";
  groupIds: string[]; // 名單群組可複選
  manualList: string;
  scheduledAt: string; // datetime-local 格式（台北時間），空字串 = 未排程
};

/** 跟進信模式：發送對象鎖定為來源群發的成效名單（開信/未開信/點擊/開信未點擊），寄出當下才解析 */
export type BroadcastFollowUp = {
  sourceId: string;
  sourceSubject: string;
  filter: import("@/lib/email/followup").FollowUpFilter;
  filterLabel: string; // 開信者 / 未開信者 / 點擊者 / 開信未點擊
  estimatedCount: number; // 目前符合人數（僅供參考，實際以寄出當下為準）
};

type BroadcastFormProps = {
  courses: { id: string; title: string }[];
  groups: GroupOption[];
  memberCount: number;
  members: MemberOption[]; // 會員清單（「選取會員」勾選用）
  sendAction: (prev: BroadcastState, formData: FormData) => Promise<BroadcastState>;
  defaultValues?: BroadcastFormDefaults; // 編輯排程/草稿時帶入
  followUp?: BroadcastFollowUp; // 跟進信模式：取代發送對象區塊
};

/** 電子報群發表單：選發送對象（全部會員/名單群組/手動名單）→ 寄測試信 → 正式群發/排程/存草稿 */
export function BroadcastForm({
  courses,
  groups,
  memberCount,
  members,
  sendAction,
  defaultValues,
  followUp,
}: BroadcastFormProps) {
  const [state, formAction, pending] = useActionState<BroadcastState, FormData>(
    sendAction,
    null,
  );
  const formRef = useRef<HTMLFormElement>(null);
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const tplNameRef = useRef<HTMLInputElement>(null);
  const [audience, setAudience] = useState<
    "all" | "group" | "manual" | "members"
  >(defaultValues?.audience ?? "all");
  const [picked, setPicked] = useState<Map<string, MemberOption>>(new Map());
  // 勾選的名單群組；用 append 保留勾選順序——與伺服器端去重的姓名優先序一致
  const [pickedGroups, setPickedGroups] = useState<string[]>(
    defaultValues?.groupIds ?? [],
  );
  // 連同「這份試算屬於哪組勾選」一起存：勾選一變動，舊結果的 key 就對不上而自動失效，
  // 不需要在 effect 裡 setState 清空（也就不會出現一瞬間的過期數字）
  const [preview, setPreview] = useState<{
    key: string;
    data: GroupAudiencePreview;
  } | null>(null);
  const [previewing, startPreview] = useTransition();
  const previewKey = pickedGroups.join(",");
  const groupPreview = preview?.key === previewKey ? preview.data : null;

  const toggleGroup = (id: string) =>
    setPickedGroups((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );

  // 勾選變動時試算人數（debounce 300ms；server action 是循序 POST，需擋過期回應）
  useEffect(() => {
    if (audience !== "group" || pickedGroups.length === 0) return;
    let alive = true;
    const timer = setTimeout(() => {
      startPreview(async () => {
        const result = await previewGroupAudienceAction(pickedGroups);
        if (alive) setPreview({ key: previewKey, data: result });
      });
    }, 300);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [audience, pickedGroups, previewKey]);

  // 即時預覽：textarea 維持非受控（避免受控輸入的游標問題），
  // 另存一份鏡像 state 供預覽渲染；程式插入語法後手動同步
  const [bodyText, setBodyText] = useState(defaultValues?.body ?? "");
  const [showPreview, setShowPreview] = useState(false);
  const [uploadingImg, setUploadingImg] = useState(false);
  const [imgError, setImgError] = useState("");
  const imgInputRef = useRef<HTMLInputElement>(null);

  // 把片段插入內文游標處（textarea 為非受控，直接改 value 即可送出）；
  // selInner=true 時選取片段中第一組「佔位文字」讓使用者直接打字取代
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
    setBodyText(el.value);
  };
  const insertVar = (token: string) => insertSnippet(token);

  // 粗體：有選取文字就直接包 **…**，沒有就插佔位字並選取，打字即取代
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
      setBodyText(el.value);
    } else {
      insertSnippet("**粗體文字**", [2, 6]);
    }
  };

  const pickImage = () => {
    setImgError("");
    imgInputRef.current?.click();
  };
  const onImagePicked = async (file: File | null) => {
    if (!file) return;
    setUploadingImg(true);
    setImgError("");
    const result = await uploadBodyImage(file);
    setUploadingImg(false);
    if (imgInputRef.current) imgInputRef.current.value = "";
    if (!result.ok) {
      setImgError(result.error);
      return;
    }
    insertSnippet(`\n\n![圖片說明](${result.url})\n\n`);
  };

  const audienceDesc = () => {
    if (followUp)
      return `跟進：${followUp.filterLabel}（來源：${followUp.sourceSubject}）`;
    if (audience === "all") return `全部 ${memberCount} 位會員`;
    if (audience === "group") {
      const names = pickedGroups
        .map((id) => groups.find((g) => g.id === id)?.name)
        .filter((n): n is string => !!n);
      if (names.length === 0) return "（尚未勾選名單群組）";
      const dedup = groupPreview
        ? `，去重後 ${groupPreview.sendableCount} 人`
        : "";
      return names.length === 1
        ? `名單群組「${names[0]}」${dedup}`
        : `${names.length} 個名單群組（${names.join("、")}）${dedup}`;
    }
    if (audience === "members") return `勾選的 ${picked.size} 位會員`;
    return "手動貼入的名單";
  };

  return (
    <>
      <form ref={formRef} action={formAction} className="space-y-4">
        <div>
          <label className="mb-1 block text-sm font-medium">主旨</label>
          <input
            name="subject"
            required
            defaultValue={defaultValues?.subject}
            placeholder="例：新課程上架｜內在豐盛工作坊開放報名"
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-black focus:outline-none"
          />
        </div>

        <div>
          <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
            <label className="block text-sm font-medium">內文</label>
            <div className="flex flex-wrap items-center gap-1.5">
              <button
                type="button"
                onClick={() => insertVar("{email}")}
                title="插入收件人 email 變數"
                className="rounded border border-gray-300 px-2 py-0.5 font-mono text-xs hover:bg-gray-50"
              >
                {"{email}"}
              </button>
              <button
                type="button"
                onClick={() => insertVar("{name}")}
                title="插入收件人姓名變數"
                className="rounded border border-gray-300 px-2 py-0.5 font-mono text-xs hover:bg-gray-50"
              >
                {"{name}"}
              </button>
              <span className="mx-0.5 h-4 w-px bg-gray-300" aria-hidden />
              <button
                type="button"
                onClick={wrapBold}
                title="粗體：選取文字後點擊，或點擊後直接輸入"
                className="rounded border border-gray-300 px-2 py-0.5 text-xs font-bold hover:bg-gray-50"
              >
                B 粗體
              </button>
              <button
                type="button"
                onClick={() => insertSnippet("\n\n## 標題文字\n\n", [4, 8])}
                title="插入標題（一行大字）"
                className="rounded border border-gray-300 px-2 py-0.5 text-xs hover:bg-gray-50"
              >
                H 標題
              </button>
              <button
                type="button"
                onClick={() => insertSnippet("\n\n---\n\n")}
                title="插入分隔線"
                className="rounded border border-gray-300 px-2 py-0.5 text-xs hover:bg-gray-50"
              >
                ― 分隔線
              </button>
              <button
                type="button"
                onClick={() =>
                  insertSnippet("\n\n[按鈕文字](https://網址)\n\n", [3, 7])
                }
                title="插入紅色 CTA 按鈕"
                className="rounded border border-gray-300 px-2 py-0.5 text-xs hover:bg-gray-50"
              >
                🔘 按鈕
              </button>
              <button
                type="button"
                onClick={pickImage}
                disabled={uploadingImg}
                title="上傳圖片並插入內文（JPG/PNG/WebP/GIF，5MB 內）"
                className="rounded border border-gray-300 px-2 py-0.5 text-xs hover:bg-gray-50 disabled:opacity-50"
              >
                {uploadingImg ? "上傳中…" : "🖼️ 圖片"}
              </button>
              <button
                type="button"
                onClick={() => setShowPreview((v) => !v)}
                className={`rounded border px-2 py-0.5 text-xs transition ${
                  showPreview
                    ? "border-indigo-400 bg-indigo-50 text-indigo-700"
                    : "border-gray-300 hover:bg-gray-50"
                }`}
              >
                👁 {showPreview ? "關閉預覽" : "即時預覽"}
              </button>
            </div>
          </div>
          <input
            ref={imgInputRef}
            type="file"
            accept={ALLOWED_IMAGE_TYPES.join(",")}
            className="hidden"
            onChange={(e) => onImagePicked(e.target.files?.[0] ?? null)}
          />
          <textarea
            ref={bodyRef}
            name="body"
            required
            defaultValue={defaultValues?.body}
            onChange={(e) => setBodyText(e.target.value)}
            rows={8}
            placeholder={"親愛的學員您好：\n\n希望學院推出新課程⋯⋯\n\n您的帳號：{email}\n預設密碼：a12345\n\n（空一行 = 分段）"}
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-black focus:outline-none"
          />
          {imgError && (
            <p className="mt-1 text-xs text-red-600">🖼️ {imgError}</p>
          )}
          {showPreview && (
            <div className="mt-2 overflow-hidden rounded-xl border border-amber-300">
              <div className="flex items-center justify-between bg-amber-50 px-3 py-1.5">
                <span className="text-xs font-medium text-amber-800">
                  即時預覽（與實際寄出走同一套排版；變數以「王小明 / example@example.com」示意）
                </span>
              </div>
              {/* 模擬品牌信：紅底頁首＋白底內文卡（完整版面以「寄測試信」為準） */}
              <div className="bg-gray-100 px-4 py-4">
                <div className="mx-auto max-w-[600px] overflow-hidden rounded-xl border border-[#c9a24b] bg-white">
                  <div className="h-1 bg-gradient-to-r from-[#c9a24b] via-[#f5d77a] to-[#c9a24b]" />
                  <div className="bg-gradient-to-br from-[#b71c1c] via-[#d32f2f] to-[#e53935] px-6 py-4 text-center text-lg font-bold tracking-widest text-white">
                    希望學院
                  </div>
                  <div
                    className="px-6 py-6 sm:px-10"
                    // 內容經 buildContentHtml 內的 esc() 轉義（與寄信同一條防注入路徑）
                    dangerouslySetInnerHTML={{
                      __html: buildContentHtml(
                        applyMergeTags(bodyText, {
                          email: "example@example.com",
                          name: "王小明",
                        }),
                      ),
                    }}
                  />
                </div>
              </div>
            </div>
          )}
          <p className="mt-1 text-xs text-gray-400">
            純文字即可，空一行會自動分段；信件會套用希望學院品牌版型（紅底 LOGO 頁首＋金邊卡片）。
            <br />
            可用變數：<span className="font-mono">{"{email}"}</span>＝收件人 email、
            <span className="font-mono">{"{name}"}</span>＝姓名，寄出時自動帶入每位收件人
            （沒有姓名的人 <span className="font-mono">{"{name}"}</span> 會留空）。
            <br />
            排版：<span className="font-mono">**粗體**</span>、
            <span className="font-mono">## 標題</span>（獨立一段）、
            <span className="font-mono">---</span>（獨立一段＝分隔線）、
            工具列上傳圖片自動插入；放連結：直接貼網址（自動變可點）；做 CTA 按鈕：
            <span className="font-mono">[立即報名](https://…)</span>
            ——連結與按鈕都會計入點擊統計。
          </p>
        </div>

        <div>
          <label className="mb-1 block text-sm font-medium">
            關聯課程（選填，信中會帶課程卡片與「查看課程」按鈕）
          </label>
          <select
            name="courseId"
            defaultValue={defaultValues?.courseId ?? ""}
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-black focus:outline-none"
          >
            <option value="">不帶課程</option>
            {courses.map((c) => (
              <option key={c.id} value={c.id}>
                {c.title}
              </option>
            ))}
          </select>
        </div>

        {/* 發送對象：跟進信模式鎖定為來源群發的成效名單，不顯示 radio */}
        {followUp ? (
          <fieldset className="rounded-xl border border-cyan-200 bg-cyan-50/60 p-4">
            <legend className="px-1 text-sm font-medium text-cyan-800">
              發送對象（跟進信）
            </legend>
            <input type="hidden" name="audience" value="followup" />
            <input type="hidden" name="sourceBroadcastId" value={followUp.sourceId} />
            <input type="hidden" name="followUpFilter" value={followUp.filter} />
            <p className="text-sm text-cyan-900">
              📬 跟進對象：<span className="font-medium">{followUp.filterLabel}</span>
              （來源：{followUp.sourceSubject}）
            </p>
            <p className="mt-1 text-xs text-cyan-700">
              目前約 {followUp.estimatedCount} 人符合；名單在「寄出當下」才解析，
              晚{followUp.filter === "NOT_OPENED" ? "開信的人會自動排除" : "開信/點擊的人也會自動納入"}，
              退訂與退信者一律不寄。
            </p>
          </fieldset>
        ) : (
        <fieldset className="rounded-xl border border-gray-200 p-4">
          <legend className="px-1 text-sm font-medium">發送對象</legend>
          <div className="space-y-2 text-sm">
            <label className="flex items-center gap-2">
              <input
                type="radio"
                name="audience"
                value="all"
                checked={audience === "all"}
                onChange={() => setAudience("all")}
              />
              全部會員（{memberCount} 位）
            </label>
            <label className="flex items-center gap-2">
              <input
                type="radio"
                name="audience"
                value="group"
                checked={audience === "group"}
                onChange={() => setAudience("group")}
              />
              名單群組
              <span className="text-xs text-gray-400">
                （可複選，重複的 Email 只會寄一次）
              </span>
              {groups.length === 0 && (
                <span className="text-xs text-gray-400">
                  （尚無群組，先到
                  <Link
                    href="/admin/broadcast/groups"
                    className="text-indigo-600 underline"
                  >
                    名單群組
                  </Link>
                  建立）
                </span>
              )}
            </label>
            {audience === "group" && groups.length > 0 && (
              <div className="ml-6 space-y-2">
                <div className="max-h-56 divide-y divide-gray-100 overflow-y-auto rounded-lg border border-gray-300">
                  {groups.map((g) => (
                    <label
                      key={g.id}
                      className="flex cursor-pointer items-center gap-2 px-3 py-1.5 text-sm hover:bg-gray-50"
                    >
                      <input
                        type="checkbox"
                        name="groupIds"
                        value={g.id}
                        checked={pickedGroups.includes(g.id)}
                        onChange={() => toggleGroup(g.id)}
                      />
                      {g.name}
                      <span className="text-xs text-gray-400">
                        （{g.memberCount} 筆）
                      </span>
                    </label>
                  ))}
                </div>
                {/* 名單試算：讓管理員在送出前親眼看到重疊被扣掉；與寄出走同一套解析 */}
                {pickedGroups.length > 0 && (
                  <div className="rounded-lg bg-indigo-50 px-3 py-2 text-xs text-indigo-800">
                    {previewing || !groupPreview ? (
                      "計算名單中…"
                    ) : (
                      <>
                        已選 {groupPreview.groups.length} 組，合計{" "}
                        {groupPreview.totalRows} 筆 → 去重後{" "}
                        <span className="font-bold">
                          {groupPreview.uniqueCount} 人
                        </span>
                        （重複／不合法 {groupPreview.duplicateCount} 筆）
                        {groupPreview.unsubscribedCount > 0 &&
                          `，扣除退訂 ${groupPreview.unsubscribedCount} 人`}
                        {" → "}實際可寄{" "}
                        <span className="font-bold">
                          {groupPreview.sendableCount} 人
                        </span>
                        <span className="mt-0.5 block text-indigo-600">
                          {groupPreview.groups
                            .map((g) => `${g.name} ${g.rowCount}`)
                            .join("・")}
                          {groupPreview.missingCount > 0 &&
                            `（有 ${groupPreview.missingCount} 組已被刪除）`}
                        </span>
                      </>
                    )}
                  </div>
                )}
              </div>
            )}
            <label className="flex items-center gap-2">
              <input
                type="radio"
                name="audience"
                value="manual"
                checked={audience === "manual"}
                onChange={() => setAudience("manual")}
              />
              手動貼入名單
            </label>
            {audience === "manual" && (
              <div className="ml-6">
                <textarea
                  name="manualList"
                  required
                  defaultValue={defaultValues?.manualList}
                  rows={6}
                  placeholder={"student1@example.com,王小明\nstudent2@example.com\n（一行一筆，可附姓名）"}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 font-mono text-sm focus:border-black focus:outline-none"
                />
                <p className="mt-1 text-xs text-amber-600">
                  💡 寄出後可把這批名單建立成群組，下次直接選用（寄出後下方會再提醒）
                </p>
              </div>
            )}
            <label className="flex items-center gap-2">
              <input
                type="radio"
                name="audience"
                value="members"
                checked={audience === "members"}
                onChange={() => setAudience("members")}
              />
              選取會員
              <span className="text-xs text-gray-400">
                （從會員清單搜尋勾選，適合補寄或個案通知）
              </span>
            </label>
            {audience === "members" && (
              <MemberPicker members={members} picked={picked} setPicked={setPicked} />
            )}
          </div>
        </fieldset>
        )}

        <div>
          <label className="mb-1 block text-sm font-medium">
            預設發送時間（選填，留空 = 按下群發立即寄出）
          </label>
          <input
            name="scheduledAt"
            type="datetime-local"
            defaultValue={defaultValues?.scheduledAt}
            className="rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-black focus:outline-none"
          />
          <p className="mt-1 text-xs text-gray-400">
            {followUp
              ? "台灣時間；到點後 5 分鐘內寄出。跟進名單於寄出當下解析，越晚寄涵蓋越多晚開信者；排程後可在下方紀錄取消"
              : "台灣時間；到點後 5 分鐘內寄出。排程後可在下方紀錄取消；全部會員/群組名單以寄出當下為準"}
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button
            type="submit"
            name="mode"
            value="test"
            disabled={pending}
            className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium transition hover:bg-gray-50 disabled:opacity-50"
          >
            {pending ? "處理中…" : "① 寄測試信給我"}
          </button>
          <button
            type="submit"
            name="mode"
            value="all"
            disabled={pending}
            onClick={(e) => {
              // checkbox 清單無法用 required 擋，自己攔下來才不會白跑一趟伺服器
              if (!followUp && audience === "group" && pickedGroups.length === 0) {
                e.preventDefault();
                alert("請至少勾選一個名單群組");
                return;
              }
              const when = (
                formRef.current?.elements.namedItem(
                  "scheduledAt",
                ) as HTMLInputElement | null
              )?.value;
              const target = audienceDesc();
              const msg = when
                ? `確定排程在 ${when.replace("T", " ")} 群發給「${target}」嗎？\n\n建議先寄測試信確認版面無誤。`
                : `確定要立即群發給「${target}」嗎？\n\n建議先寄測試信確認版面無誤。送出後無法收回。`;
              if (!confirm(msg)) {
                e.preventDefault();
              }
            }}
            className="rounded-lg bg-red-600 px-5 py-2 text-sm font-medium text-white transition hover:bg-red-700 disabled:opacity-50"
          >
            {pending ? "處理中…" : "② 正式群發"}
          </button>
          <button
            type="submit"
            name="mode"
            value="draft"
            formNoValidate
            disabled={pending}
            className="ml-auto rounded-lg border border-gray-300 px-4 py-2 text-sm text-gray-600 transition hover:bg-gray-50 disabled:opacity-50"
            title="只需填主旨即可儲存，之後可在寄送紀錄繼續編輯"
          >
            {pending ? "處理中…" : "存草稿"}
          </button>
          {/* 存成範本：把主旨/內文/關聯課程存進範本庫（不寄信），之後可一鍵帶入 */}
          <input type="hidden" name="templateName" ref={tplNameRef} />
          <button
            type="submit"
            name="mode"
            value="template"
            formNoValidate
            disabled={pending}
            onClick={(e) => {
              const subj =
                (
                  formRef.current?.elements.namedItem(
                    "subject",
                  ) as HTMLInputElement | null
                )?.value.trim() ?? "";
              const name = prompt(
                "範本名稱（同名儲存會覆蓋更新）：",
                subj,
              );
              if (name === null) {
                e.preventDefault();
                return;
              }
              if (tplNameRef.current) tplNameRef.current.value = name.trim();
            }}
            className="rounded-lg border border-indigo-300 px-4 py-2 text-sm text-indigo-600 transition hover:bg-indigo-50 disabled:opacity-50"
            title="把目前的主旨／內文／關聯課程存成範本，之後群發可一鍵帶入"
          >
            {pending ? "處理中…" : "📄 存成範本"}
          </button>
        </div>

        {state?.success && (
          <div className="rounded-lg bg-green-50 px-4 py-3 text-sm text-green-700">
            ✓ {state.success}
          </div>
        )}
        {state?.error && (
          <div className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">
            {state.error}
          </div>
        )}
      </form>

      {/* 手動名單寄出/排程後的提醒：是否將此名單建立群組？ */}
      {state?.broadcastId && (state.manualCount ?? 0) > 0 && (
        <SaveListPrompt
          broadcastId={state.broadcastId}
          manualCount={state.manualCount!}
          groups={groups}
        />
      )}
    </>
  );
}

const PICKER_MAX_SHOWN = 30;

/** 選取會員：搜尋會員清單 → 勾選 → 以隱藏欄位（email,姓名 行格式）隨表單送出 */
function MemberPicker({
  members,
  picked,
  setPicked,
}: {
  members: MemberOption[];
  picked: Map<string, MemberOption>;
  setPicked: (next: Map<string, MemberOption>) => void;
}) {
  const [q, setQ] = useState("");
  const keyword = q.trim().toLowerCase();
  const matched = keyword
    ? members.filter(
        (m) =>
          m.email.toLowerCase().includes(keyword) ||
          m.name.toLowerCase().includes(keyword),
      )
    : members;
  const shown = matched.slice(0, PICKER_MAX_SHOWN);

  const toggle = (m: MemberOption) => {
    const next = new Map(picked);
    if (next.has(m.email)) next.delete(m.email);
    else next.set(m.email, m);
    setPicked(next);
  };

  return (
    <div className="ml-6 space-y-2">
      <input
        type="hidden"
        name="memberList"
        value={[...picked.values()]
          .map((m) => (m.name ? `${m.email},${m.name}` : m.email))
          .join("\n")}
      />

      {picked.size > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-xs text-gray-500">已勾選 {picked.size} 位：</span>
          {[...picked.values()].map((m) => (
            <button
              key={m.email}
              type="button"
              onClick={() => toggle(m)}
              title="點擊移除"
              className="inline-flex items-center gap-1 rounded-full bg-indigo-50 px-2 py-0.5 text-xs text-indigo-700 hover:bg-indigo-100"
            >
              {m.name || m.email}
              <span className="text-indigo-400">✕</span>
            </button>
          ))}
          <button
            type="button"
            onClick={() => setPicked(new Map())}
            className="text-xs text-gray-400 hover:text-red-600 hover:underline"
          >
            全部清除
          </button>
        </div>
      )}

      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="搜尋 email 或姓名…"
        className="w-80 rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-black focus:outline-none"
      />

      <div className="max-h-56 overflow-y-auto rounded-lg border border-gray-200 divide-y divide-gray-100">
        {shown.length === 0 && (
          <p className="px-3 py-3 text-sm text-gray-400">
            沒有符合「{q.trim()}」的會員
          </p>
        )}
        {shown.map((m) => (
          <label
            key={m.email}
            className="flex cursor-pointer items-center gap-2 px-3 py-1.5 text-sm hover:bg-gray-50"
          >
            <input
              type="checkbox"
              checked={picked.has(m.email)}
              onChange={() => toggle(m)}
            />
            <span className="font-mono">{m.email}</span>
            {m.name && <span className="text-gray-500">{m.name}</span>}
          </label>
        ))}
        {matched.length > PICKER_MAX_SHOWN && (
          <p className="px-3 py-2 text-xs text-gray-400">
            還有 {matched.length - PICKER_MAX_SHOWN} 筆未顯示，輸入關鍵字縮小範圍
          </p>
        )}
      </div>
      <p className="text-xs text-gray-400">
        名單來源＝已註冊會員（同會員管理頁）；寄出後同樣可存成群組
      </p>
    </div>
  );
}

/** 「是否將此名單建立群組？」：建新群組或併入既有群組 */
function SaveListPrompt({
  broadcastId,
  manualCount,
  groups,
}: {
  broadcastId: string;
  manualCount: number;
  groups: GroupOption[];
}) {
  return (
    <form
      action={saveBroadcastListToGroupAction.bind(null, broadcastId)}
      className="mt-4 space-y-3 rounded-xl border border-amber-300 bg-amber-50 p-4"
    >
      <p className="text-sm font-medium text-amber-800">
        💾 是否將此名單建立群組？這批 {manualCount} 筆名單可以存起來，下次群發直接選用。
      </p>
      <div className="flex flex-wrap items-end gap-2">
        <div>
          <label className="mb-1 block text-xs text-amber-800">
            建立新群組
          </label>
          <input
            name="newName"
            placeholder="新群組名稱"
            className="rounded-lg border border-amber-300 bg-white px-3 py-2 text-sm focus:border-black focus:outline-none"
          />
        </div>
        {groups.length > 0 && (
          <>
            <span className="pb-2 text-xs text-amber-700">或加入既有群組</span>
            <select
              name="groupId"
              defaultValue=""
              className="rounded-lg border border-amber-300 bg-white px-3 py-2 text-sm focus:border-black focus:outline-none"
            >
              <option value="">— 選擇群組 —</option>
              {groups.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}（{g.memberCount} 筆）
                </option>
              ))}
            </select>
          </>
        )}
        <SubmitButton
          pendingText="存入中…"
          className="rounded-lg bg-amber-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-amber-700"
        >
          存入群組
        </SubmitButton>
      </div>
      <p className="text-xs text-amber-700">
        填了新群組名稱以新群組為準；存入後會跳轉到該群組頁面。不需要的話直接忽略即可。
      </p>
    </form>
  );
}
