"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useActionState } from "react";
import Link from "next/link";
import {
  previewSmsAudienceAction,
  sendSmsAction,
  sendSmsTestAction,
  type SmsState,
} from "@/actions/sms";
import { countSms, hasEmoji } from "@/lib/sms/message";
import { formatCents } from "@/lib/sms/settings";
import { SubmitButton } from "@/components/admin/submit-button";

type SessionOption = {
  id: string;
  title: string;
  signupCount: number;
  accessCode: string | null; // 有值 = 這場已開放 /live 索取，{code} 才有東西可帶
};

type WebinarOption = {
  id: string;
  title: string;
  requestCount: number; // 索取人數
  withPhoneCount: number; // 其中有手機的人數——差額就是「發不到的人」，勾選前就要看得到
};

type PreviewData = Awaited<ReturnType<typeof previewSmsAudienceAction>>;

/** 帶入既有內容：草稿（可改同一筆）或複製既有紀錄（id=null，另存新的一則） */
export type SmsInitial = {
  id: string | null;
  title: string;
  body: string;
  audience: "session" | "webinar" | "manual";
  sessionIds: string[];
  webinarIds?: string[];
  manualList: string;
  /** 場次名單範圍：ALL＝全部報名者；PENDING＝只發還沒收到課前簡訊的人 */
  noticeScope?: "ALL" | "PENDING";
  /** 單人補通知：回寫「已通知」用的名單列 id（手動名單沒有場次可對照） */
  signupIds?: string[];
  scheduledAt: string; // datetime-local 格式（台北時間）；過期或複製時給空字串
  copiedFrom?: string | null; // 複製來源的標題，畫面上標示用
  /** 補發模式：帶入「這場還沒收到的人」的手動名單快照（已收到的不重寄） */
  followUp?: {
    sourceTitle: string;
    count: number;
    alreadySent: number;
    noMobileCount: number;
    retryFailed: { mobile: string; name?: string; reason: string | null }[];
    error?: string | null;
  } | null;
};

type Props = {
  sessions: SessionOption[];
  webinars: WebinarOption[];
  brandPrefix: string;
  isLive: boolean;
  providerLabel: string;
  initial?: SmsInitial | null;
};

/** 簡訊發送表單：選對象（場次／手動）→ 即時試算人數與金額 → 測試發送 → 正式發送／排程。
 *  帶 initial 時是「編輯草稿／複製既有紀錄」——草稿存回同一筆，複製則另存新的。 */
export function SmsForm({
  sessions,
  webinars,
  brandPrefix,
  isLive,
  providerLabel,
  initial,
}: Props) {
  const [state, formAction, pending] = useActionState<SmsState, FormData>(
    sendSmsAction,
    null,
  );
  const [testState, testAction, testPending] = useActionState<SmsState, FormData>(
    sendSmsTestAction,
    null,
  );
  const formRef = useRef<HTMLFormElement>(null);

  const [audience, setAudience] = useState<"session" | "webinar" | "manual">(
    initial?.audience ?? "session",
  );
  const [pickedSessions, setPickedSessions] = useState<string[]>(initial?.sessionIds ?? []);
  const [pickedWebinars, setPickedWebinars] = useState<string[]>(initial?.webinarIds ?? []);
  const [manualList, setManualList] = useState(initial?.manualList ?? "");
  const [noticeScope, setNoticeScope] = useState<"ALL" | "PENDING">(
    initial?.noticeScope ?? "ALL",
  );
  const [body, setBody] = useState(initial?.body ?? "");
  const [noticeAck, setNoticeAck] = useState(false);
  // 存過一次之後就一直改同一筆草稿——不然每按一次「存草稿」就多一則
  const [draftId, setDraftId] = useState(initial?.id ?? "");
  if (state?.isDraft && state.broadcastId && state.broadcastId !== draftId) {
    setDraftId(state.broadcastId);
  }

  const [preview, setPreview] = useState<{ key: string; data: PreviewData } | null>(
    null,
  );
  const [previewing, startPreview] = useTransition();

  // 本階段只開放履約通知：行銷推播需先完成退訂機制才合規（NCC 規定）
  const messageType = "NOTICE";

  const toggleSession = (id: string) =>
    setPickedSessions((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  const toggleWebinar = (id: string) =>
    setPickedWebinars((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );

  const previewKey = JSON.stringify({
    audience,
    pickedSessions,
    pickedWebinars,
    manualList,
    body,
    noticeScope,
  });
  const current = preview?.key === previewKey ? preview.data : null;

  const hasTarget =
    audience === "manual"
      ? manualList.trim().length > 0
      : audience === "webinar"
        ? pickedWebinars.length > 0
        : pickedSessions.length > 0;

  useEffect(() => {
    if (!hasTarget) return;
    let alive = true;
    const timer = setTimeout(() => {
      startPreview(async () => {
        const r = await previewSmsAudienceAction({
          audienceType: audience,
          sessionIds: pickedSessions,
          webinarIds: pickedWebinars,
          manualList,
          noticeScope,
          messageType,
          body,
        });
        if (alive) setPreview({ key: previewKey, data: r });
      });
    }, 400);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [
    audience,
    pickedSessions,
    pickedWebinars,
    manualList,
    body,
    noticeScope,
    hasTarget,
    previewKey,
  ]);

  // 即時字數：以「王小明」等長姓名估算，與伺服器端的上界估法一致
  const sampleText = `${brandPrefix}${body
    .replace(/\{name\}/g, "王小明")
    .replace(/\{mobile\}/g, "0912345678")
    // 上課碼固定 4 位，估算字數不會有誤差
    .replace(/\{code\}/g, "8241")}`;
  const count = countSms(sampleText);
  const bodyHasEmoji = hasEmoji(body);

  return (
    <>
      {!isLive && (
        <div className="mb-4 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          ⚠️ 目前是<strong>{providerLabel}</strong>——按下發送不會真的送出簡訊，也不會產生任何費用。
          內容會印在伺服器記錄供檢查。接上簡訊商後才會實際發送。
        </div>
      )}

      {/* 補發模式：先把「為什麼是這些人」講清楚，管理員才敢直接按發送 */}
      {initial?.followUp && !draftId && (
        <div
          className={`mb-4 rounded-xl border px-4 py-3 text-sm ${
            initial.followUp.error || initial.followUp.count === 0
              ? "border-gray-300 bg-gray-50 text-gray-700"
              : "border-amber-300 bg-amber-50 text-amber-900"
          }`}
        >
          {initial.followUp.error ? (
            <span>⚠️ {initial.followUp.error}</span>
          ) : initial.followUp.count === 0 ? (
            <span>
              「{initial.followUp.sourceTitle}」目前名單上<strong>沒有漏發的人</strong>
              ——有手機的都已經收到了
              {initial.followUp.noMobileCount > 0 && (
                <>
                  ；另有 <strong>{initial.followUp.noMobileCount} 人收不到簡訊</strong>
                  （沒有手機號碼，或是海外門號——本站不發國際簡訊），
                  補了號碼再回來按一次「補發」才收得到；海外門號補不了，請改寄 Email
                </>
              )}
              。
            </span>
          ) : (
            <>
              <div>
                📮 補發「{initial.followUp.sourceTitle}」：名單上還沒收到的{" "}
                <strong>{initial.followUp.count} 人</strong>已帶入下方手動名單
                （發送後才報名、事後才補手機、上次送失敗的人）。
              </div>
              <div className="mt-1 text-xs">
                已收到的 {initial.followUp.alreadySent} 人不在名單裡，不會重複收到、不會重複計費；
                名單可自行刪減後再送出。
                {initial.followUp.noMobileCount > 0 && (
                  <span className="ml-1 font-medium">
                    另有 {initial.followUp.noMobileCount} 人收不到簡訊：沒號碼的請先到場次名單補；
                    名單上標「海外·Email」的補不了（不發國際簡訊），請改寄 Email。
                  </span>
                )}
              </div>
              {/* 上次送失敗多半是空號：直接再送還是會失敗又要付錢，先讓人看到號碼與原因 */}
              {initial.followUp.retryFailed.length > 0 && (
                <div className="mt-1.5 rounded-lg bg-white/60 px-2 py-1.5 text-xs">
                  ⚠️ 其中 <strong>{initial.followUp.retryFailed.length} 人是上次送失敗的號碼</strong>
                  ，直接再送很可能還是失敗——建議先到場次名單確認號碼：
                  <ul className="mt-0.5 list-inside list-disc">
                    {initial.followUp.retryFailed.slice(0, 5).map((r) => (
                      <li key={r.mobile}>
                        {r.name ?? "（無姓名）"} {r.mobile}
                        {r.reason ? `　${r.reason}` : ""}
                      </li>
                    ))}
                    {initial.followUp.retryFailed.length > 5 && (
                      <li>等 {initial.followUp.retryFailed.length} 人</li>
                    )}
                  </ul>
                </div>
              )}
            </>
          )}
          <Link href="/admin/sms" className="mt-1 block text-xs text-indigo-600 underline">
            清空，改寫新的一則
          </Link>
        </div>
      )}

      {(draftId || (initial && !initial.followUp)) && (
        <div className="mb-4 flex flex-wrap items-center gap-2 rounded-xl border border-indigo-200 bg-indigo-50 px-4 py-2.5 text-sm text-indigo-900">
          <span>
            {draftId ? (
              <>
                正在編輯草稿——按「更新草稿」存回同一則，內容確定後直接「
                {isLive ? "正式發送" : "模擬發送"}」即可
              </>
            ) : (
              <>
                已帶入
                {initial?.copiedFrom ? `「${initial.copiedFrom}」` : "既有紀錄"}
                的內容（複製，不會動到原紀錄）——改完可存成新草稿或直接發送
              </>
            )}
          </span>
          <Link href="/admin/sms" className="ml-auto text-xs text-indigo-600 underline">
            清空，改寫新的一則
          </Link>
        </div>
      )}

      <form ref={formRef} action={formAction} className="space-y-4">
        <input type="hidden" name="messageType" value={messageType} />
        {/* 有值 = 改既有草稿（server action 會確認它仍是 DRAFT 才寫） */}
        <input type="hidden" name="draftId" value={draftId} />

        <div>
          <label className="mb-1 block text-sm font-medium">
            標題 <span className="text-xs font-normal text-gray-400">（後台識別用，不會出現在簡訊裡）</span>
          </label>
          <input
            name="title"
            defaultValue={initial?.title ?? ""}
            placeholder="例：8/20 台北場 上課前一日提醒"
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-black focus:outline-none"
          />
        </div>

        <div>
          <label className="mb-1 block text-sm font-medium">簡訊內容</label>
          <textarea
            name="body"
            required
            rows={5}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder={"{name} 您好，提醒您明天 9:00 於台北場上課，請攜帶筆電。"}
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-black focus:outline-none"
          />
          <div className="mt-1 flex flex-wrap items-center gap-3 text-xs">
            <span className="text-gray-500">
              可用變數：
              <button
                type="button"
                onClick={() => setBody((b) => b + "{name}")}
                className="mx-1 rounded border border-gray-300 px-1.5 py-0.5 hover:bg-gray-50"
              >
                {"{name}"}
              </button>
              姓名
              <button
                type="button"
                onClick={() => setBody((b) => b + "{code}")}
                title="該場次的 /live 上課碼；學員憑碼取得 Zoom 連結"
                className="mx-1 rounded border border-gray-300 px-1.5 py-0.5 hover:bg-gray-50"
              >
                {"{code}"}
              </button>
              上課碼
            </span>
            <span className={count.segments > 1 ? "text-amber-600" : "text-gray-400"}>
              含品牌標示共 {count.length} 字 · <strong>{count.segments} 則</strong>
              （{count.encoding === "UCS2" ? "中文 70 字/則" : "英數 160 字/則"}，本段還可打 {count.remaining} 字）
            </span>
          </div>
          {bodyHasEmoji && (
            <p className="mt-1 text-xs text-red-600">
              內容含 emoji：各家電信顯示不一致且會影響計費則數，請移除
            </p>
          )}
          <p className="mt-1 text-xs text-gray-400">
            實際送出會自動在開頭加上「{brandPrefix}」
          </p>
        </div>

        <fieldset className="rounded-xl border border-gray-200 p-4">
          <legend className="px-1 text-sm font-medium">發送對象</legend>
          <div className="space-y-2 text-sm">
            <label className="flex items-center gap-2">
              <input
                type="radio"
                name="audience"
                value="session"
                checked={audience === "session"}
                onChange={() => setAudience("session")}
              />
              場次報名者
              <span className="text-xs text-gray-400">（可複選，重複報名的人只會收到一則）</span>
            </label>
            {/* 名單範圍：開課前會重複匯入名單，多數時候只需要通知這次新進來的人。
                口徑是「還沒收到課前簡訊的人」，所以漏發、送失敗的也會被撈回來。 */}
            {audience !== "manual" && (
              <div className="ml-6 mb-2 flex flex-wrap items-center gap-4 text-sm">
                <input type="hidden" name="noticeScope" value={noticeScope} />
                <label className="flex cursor-pointer items-center gap-1.5">
                  <input
                    type="radio"
                    checked={noticeScope === "ALL"}
                    onChange={() => setNoticeScope("ALL")}
                  />
                  全部報名者
                </label>
                <label className="flex cursor-pointer items-center gap-1.5">
                  <input
                    type="radio"
                    checked={noticeScope === "PENDING"}
                    onChange={() => setNoticeScope("PENDING")}
                  />
                  只發還沒收到的人
                  <span className="text-xs text-gray-400">
                    {audience === "webinar"
                      ? "（陸續有人登記時只通知新名單）"
                      : "（重複匯入後只通知新名單）"}
                  </span>
                </label>
              </div>
            )}
            {audience === "session" && (
              <div className="ml-6 max-h-56 divide-y divide-gray-100 overflow-y-auto rounded-lg border border-gray-300">
                {sessions.length === 0 ? (
                  <p className="px-3 py-2 text-xs text-gray-400">
                    尚無場次，請先到
                    <Link href="/admin/sessions" className="mx-1 text-indigo-600 underline">
                      場次看板
                    </Link>
                    建立
                  </p>
                ) : (
                  sessions.map((s) => (
                    <label
                      key={s.id}
                      className="flex cursor-pointer items-center gap-2 px-3 py-1.5 text-sm hover:bg-gray-50"
                    >
                      <input
                        type="checkbox"
                        name="sessionIds"
                        value={s.id}
                        checked={pickedSessions.includes(s.id)}
                        onChange={() => toggleSession(s.id)}
                      />
                      {s.title}
                      <span className="text-xs text-gray-400">（{s.signupCount} 人報名）</span>
                      {s.accessCode ? (
                        <span className="rounded-full bg-sky-100 px-1.5 py-0.5 text-xs text-sky-800">
                          上課碼 {s.accessCode}
                        </span>
                      ) : (
                        <span className="text-xs text-gray-300">未設上課碼</span>
                      )}
                    </label>
                  ))
                )}
              </div>
            )}

            <label className="flex items-center gap-2">
              <input
                type="radio"
                name="audience"
                value="webinar"
                checked={audience === "webinar"}
                onChange={() => setAudience("webinar")}
              />
              講座索取者
              <span className="text-xs text-gray-400">
                （可複選，重複登記多場的人只會收到一則）
              </span>
            </label>
            {audience === "webinar" && (
              <div className="ml-6 max-h-56 divide-y divide-gray-100 overflow-y-auto rounded-lg border border-gray-300">
                {webinars.length === 0 ? (
                  <p className="px-3 py-2 text-xs text-gray-400">
                    尚無講座，請先到
                    <Link href="/admin/webinars" className="mx-1 text-indigo-600 underline">
                      講座報名
                    </Link>
                    建立
                  </p>
                ) : (
                  webinars.map((w) => {
                    // 沒有手機的人發不到。手機必填是 2026-09-02 才上線，
                    // 更早的索取紀錄一定是 0，勾選前就講清楚比送出後才發現好。
                    const noPhone = w.requestCount - w.withPhoneCount;
                    return (
                      <label
                        key={w.id}
                        className="flex cursor-pointer items-center gap-2 px-3 py-1.5 text-sm hover:bg-gray-50"
                      >
                        <input
                          type="checkbox"
                          name="webinarIds"
                          value={w.id}
                          checked={pickedWebinars.includes(w.id)}
                          onChange={() => toggleWebinar(w.id)}
                        />
                        {w.title}
                        <span className="text-xs text-gray-400">
                          （{w.requestCount} 人索取）
                        </span>
                        {noPhone > 0 && (
                          <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-xs text-amber-800">
                            {noPhone} 人沒手機
                          </span>
                        )}
                      </label>
                    );
                  })
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
            {/* 從名單列「簡訊」按鈕進來的單人補通知：帶著名單列 id，
                發送成功才回寫得了「已通知」，這個人才不會一直留在未通知被重複發送 */}
            {audience === "manual" &&
              (initial?.signupIds ?? []).map((id) => (
                <input key={id} type="hidden" name="signupIds" value={id} />
              ))}
            {audience === "manual" && (
              <textarea
                name="manualList"
                rows={5}
                value={manualList}
                onChange={(e) => setManualList(e.target.value)}
                placeholder={"0912345678,王小明\n0987654321\n（一行一筆，可附姓名）"}
                className="ml-6 w-full rounded-lg border border-gray-300 px-3 py-2 font-mono text-sm focus:border-black focus:outline-none"
              />
            )}

            {/* 名單試算：這是花錢模組最重要的一塊，發送前必須看得到 */}
            {hasTarget && (
              <div className="ml-6 rounded-lg bg-indigo-50 px-3 py-2 text-xs text-indigo-900">
                {previewing || !current ? (
                  "計算名單中…"
                ) : (
                  <>
                    <div>
                      名單合計 {current.totalRows} 筆
                      {current.noMobileCount > 0 && (
                        <span className="font-bold text-amber-700">
                          {" "}
                          · 無手機／市話／海外門號 {current.noMobileCount} 人收不到 ⚠️
                        </span>
                      )}
                    </div>
                    <div>
                      去重後 {current.uniqueCount} 人
                      {current.duplicateCount > 0 &&
                        `（${audience === "webinar" ? "跨講座" : "跨場次"}重複 ${current.duplicateCount} 筆）`}
                      {current.optedOutCount > 0 && ` · 已退訂／無法送達 ${current.optedOutCount} 人`}
                    </div>
                    {/* 用了 {code} 卻有人所屬場次沒設碼：那些人會收到一則沒有碼的通知，
                        等於白發還要付錢，必須在按下發送前擋在眼前 */}
                    {body.includes("{code}") &&
                      current.withCodeCount < current.sendableCount && (
                        <div className="mt-1 rounded bg-amber-100 px-2 py-1 text-amber-900">
                          {audience === "webinar" ? (
                            <>
                              ⚠️ 內容用了 {"{code}"}，但<strong>講座沒有上課碼</strong>
                              （連結是登記當下直接寄信給本人），這個變數會被換成空白。
                              請把 {"{code}"} 從內容裡移除。
                            </>
                          ) : (
                            <>
                              ⚠️ 內容用了 {"{code}"}，但其中{" "}
                              <strong>
                                {current.sendableCount - current.withCodeCount} 人
                              </strong>
                              所屬場次還沒設上課碼，他們收到的會是一則沒有碼的簡訊。
                              請先到場次看板設定「上課連結」。
                            </>
                          )}
                        </div>
                      )}
                    <div className="mt-0.5 border-t border-indigo-200 pt-1 font-bold">
                      實際可發 {current.sendableCount} 人 × {current.segments} 則
                      {isLive
                        ? ` = 預估 ${formatCents(current.estimatedCents)}`
                        : "（測試模式，不計費）"}
                    </div>
                    <div className="mt-0.5 text-indigo-600">
                      {current.sources.map((s) => `${s.label} ${s.rowCount}`).join("・")}
                      {current.missingCount > 0 && `（有 ${current.missingCount} 個已被刪除）`}
                    </div>
                  </>
                )}
              </div>
            )}
          </div>
        </fieldset>

        <div>
          <label className="mb-1 block text-sm font-medium">
            預定發送時間 <span className="text-xs font-normal text-gray-400">（留空 = 立即發送；台北時間，最多晚 5 分鐘）</span>
          </label>
          <input
            type="datetime-local"
            name="scheduledAt"
            defaultValue={initial?.scheduledAt ?? ""}
            className="rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-black focus:outline-none"
          />
        </div>

        <label className="flex items-start gap-2 rounded-lg bg-gray-50 px-3 py-2 text-sm">
          <input
            type="checkbox"
            name="noticeAck"
            checked={noticeAck}
            onChange={(e) => setNoticeAck(e.target.checked)}
            className="mt-0.5"
          />
          <span>
            我確認這是與<strong>已報名學員</strong>的履約通知（上課提醒／異動通知），不是行銷推播。
            <span className="block text-xs text-gray-500">
              行銷推播依 NCC 規定須提供免費退訂方式，退訂機制完成前尚未開放。
            </span>
          </span>
        </label>

        <div className="flex flex-wrap items-center gap-3 border-t border-gray-100 pt-4">
          <button
            type="submit"
            name="mode"
            value="send"
            disabled={pending}
            onClick={(e) => {
              if (!hasTarget) {
                e.preventDefault();
                alert(audience === "manual" ? "請貼入名單" : "請至少勾選一個場次");
                return;
              }
              const when = (
                formRef.current?.elements.namedItem("scheduledAt") as HTMLInputElement | null
              )?.value;
              const n = current?.sendableCount ?? 0;
              const cost = isLive
                ? `預估費用 ${formatCents(current?.estimatedCents ?? 0)}`
                : "測試模式，不會實際發送也不會計費";
              const warn =
                current && current.noMobileCount > 0
                  ? `\n\n注意：有 ${current.noMobileCount} 人沒有可用手機（含海外門號），收不到這則簡訊。`
                  : "";
              const msg = when
                ? `確定排程在 ${when.replace("T", " ")} 發送給 ${n} 人嗎？\n${cost}${warn}`
                : `確定立即發送給 ${n} 人嗎？\n${cost}${warn}\n\n送出後無法收回。`;
              if (!confirm(msg)) e.preventDefault();
            }}
            className="rounded-lg bg-red-600 px-5 py-2 text-sm font-medium text-white transition hover:bg-red-700 disabled:opacity-50"
          >
            {pending ? "處理中…" : isLive ? "正式發送" : "模擬發送（測試模式）"}
          </button>
          <button
            type="submit"
            name="mode"
            value="draft"
            formNoValidate
            disabled={pending}
            className="ml-auto rounded-lg border border-gray-300 px-4 py-2 text-sm text-gray-600 transition hover:bg-gray-50 disabled:opacity-50"
          >
            {pending ? "處理中…" : draftId ? "更新草稿" : "存草稿"}
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

      {/* 測試發送：獨立表單，只送給指定號碼，不留紀錄 */}
      <form action={testAction} className="mt-6 rounded-xl border border-dashed border-gray-300 p-4">
        <div className="mb-2 text-sm font-medium">先寄一則測試簡訊</div>
        <input type="hidden" name="body" value={body} />
        <input type="hidden" name="messageType" value={messageType} />
        {/* {code} 用第一個勾選場次的碼，測試簡訊才看得到真實內容與正確則數 */}
        <input
          type="hidden"
          name="testSessionId"
          value={audience === "session" ? (pickedSessions[0] ?? "") : ""}
        />
        <div className="flex flex-wrap items-center gap-2">
          <input
            name="testMobile"
            placeholder="09xxxxxxxx"
            inputMode="numeric"
            className="w-48 rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-black focus:outline-none"
          />
          <SubmitButton pendingText="發送中…">送出測試</SubmitButton>
          {testPending && <span className="text-xs text-gray-400">處理中…</span>}
        </div>
        {testState?.success && (
          <p className="mt-2 text-sm text-green-700">✓ {testState.success}</p>
        )}
        {testState?.error && (
          <p className="mt-2 text-sm text-red-700">{testState.error}</p>
        )}
      </form>
    </>
  );
}
