"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requireEditor } from "@/lib/auth/staff";
import { explainMobile, MOBILE_REJECT_LABEL } from "@/lib/sms/phone";
import { isRetrainProduct, isSamePerson } from "@/lib/session-roster";
import { buildBroadcastHtml, sendBroadcast } from "@/lib/email/broadcast";
import {
  SIGNUP_SLUG_RE,
  SIGNUP_REQUEST_STATUS,
  parseDmBlocks,
  type DmBlock,
  MAX_ATTENDEES,
  attendeeKeyAt,
  makeWebOrderNo,
  signupState,
  CLOSED_MESSAGE,
} from "@/lib/session-signup-page";

// 場次公開報名頁：後台設定 ＋ 訪客送出報名 ＋ 管理員確認收款轉入名單。
//
// Phase 1 不接金流：訪客送出寫進 SessionSignupRequest（待確認），
// 管理員收到款後按「轉入名單」才寫 SessionSignup。理由見 schema 的模型註解。

export type SignupPageState = { error?: string; success?: string } | null;
export type PublicSignupState = { error?: string; success?: string } | null;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DUP_WINDOW_MS = 60 * 1000; // 同信箱同場次重複送出的視窗，防連點與灌單

// ───────────────────────── 後台：報名頁設定 ─────────────────────────

/** 台北時間的 datetime-local 字串 → Date；空字串回 null，格式錯回 undefined */
function parseTaipeiDateTime(raw: string): Date | null | undefined {
  const s = raw.trim();
  if (!s) return null;
  const d = new Date(`${s}:00+08:00`);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

export async function updateSignupPageAction(
  sessionId: string,
  _prev: SignupPageState,
  formData: FormData,
): Promise<SignupPageState> {
  await requireEditor();

  const slug = String(formData.get("signupSlug") ?? "").trim().toLowerCase();
  if (slug && !SIGNUP_SLUG_RE.test(slug)) {
    return { error: "網址代稱只能用小寫英數與連字號（例：quantum-2-taipei-0919）" };
  }
  const isSignupOpen = formData.get("isSignupOpen") === "on";
  if (isSignupOpen && !slug) {
    return { error: "要開放報名請先填網址代稱，否則報名頁沒有網址可以開" };
  }

  // DM 圖：瀏覽器已直傳 Supabase Storage，這裡只收公開網址字串（同課程封面／講座 DM 模式）
  const dmImage = String(formData.get("dmImage") ?? "").trim() || null;
  if (dmImage && !/^https?:\/\//.test(dmImage)) return { error: "DM 圖網址格式錯誤" };
  // 詳情區塊：前端把整包有序清單序列化成一個 JSON 欄位送上來（順序就是顯示順序）。
  // 一律重新解析驗證，不信任前端送的形狀。
  let dmBlocks: DmBlock[];
  try {
    dmBlocks = parseDmBlocks(JSON.parse(String(formData.get("dmBlocks") ?? "[]")));
  } catch {
    return { error: "課程詳情區塊資料格式錯誤，請重新整理後再試" };
  }

  // 外部報名網址（1shop）：有值時報名頁只當落地頁，顯示 CTA 導出去
  const signupUrl = String(formData.get("signupUrl") ?? "").trim() || null;
  if (signupUrl && !/^https?:\/\//.test(signupUrl)) {
    return { error: "報名網址須為 http(s) 開頭的完整網址" };
  }

  // 報名方式：EXTERNAL 導外部 / PLATFORM 平台線上金流（刷卡＋ATM）/ MANUAL 內建表單手動收款
  const payMode = String(formData.get("signupPayMode") ?? "MANUAL");
  if (!["EXTERNAL", "PLATFORM", "MANUAL"].includes(payMode)) {
    return { error: "報名方式選項不正確" };
  }
  const priceRaw = String(formData.get("signupPrice") ?? "").trim();
  let signupPrice: number | null = null;
  if (priceRaw) {
    const n = Number(priceRaw);
    if (!Number.isInteger(n) || n < 0) return { error: "報名費用請填 0 以上的整數" };
    signupPrice = n;
  }
  if (payMode === "EXTERNAL" && !signupUrl) {
    return { error: "選「導去外部報名頁」請填外部報名網址" };
  }
  if (payMode === "PLATFORM" && (signupPrice === null || signupPrice <= 0)) {
    return { error: "選「平台線上金流」請填每人報名費用（大於 0）" };
  }

  const openAt = parseTaipeiDateTime(String(formData.get("signupOpenAt") ?? ""));
  if (openAt === undefined) return { error: "報名開始時間格式錯誤" };
  const closeAt = parseTaipeiDateTime(String(formData.get("signupCloseAt") ?? ""));
  if (closeAt === undefined) return { error: "報名截止時間格式錯誤" };
  if (openAt && closeAt && openAt >= closeAt) {
    return { error: "報名截止時間要晚於開始時間" };
  }

  const quotaRaw = String(formData.get("signupQuota") ?? "").trim();
  let signupQuota: number | null = null;
  if (quotaRaw) {
    const n = Number(quotaRaw);
    if (!Number.isInteger(n) || n < 1) return { error: "名額上限請填正整數，或留空表示不限額" };
    signupQuota = n;
  }

  const text = (k: string) => String(formData.get(k) ?? "").trim() || null;

  try {
    await prisma.courseSession.update({
      where: { id: sessionId },
      data: {
        signupSlug: slug || null,
        isSignupOpen,
        signupUrl,
        signupPayMode: payMode,
        signupPrice,
        dmImage,
        dmBlocks,
        signupIntro: text("signupIntro"),
        venue: text("venue"),
        address: text("address"),
        signupOpenAt: openAt,
        signupCloseAt: closeAt,
        signupQuota,
        signupPriceNote: text("signupPriceNote"),
        signupPayNote: text("signupPayNote"),
        signupNotice: text("signupNotice"),
        signupGroupId: text("signupGroupId"),
      },
    });
  } catch (e) {
    if (e instanceof Error && e.message.includes("Unique constraint")) {
      return { error: `網址代稱「${slug}」已被其他場次使用，請換一個` };
    }
    throw e;
  }

  revalidatePath(`/admin/sessions/${sessionId}/signup-page`);
  revalidatePath("/admin/sessions");
  if (slug) revalidatePath(`/event/${slug}`);
  return { success: "報名頁設定已儲存" };
}

// ───────────────────────── 前台：訪客送出報名 ─────────────────────────

type ParsedAttendee = {
  name: string;
  phone: string | null;
  email: string | null;
  meal: "MEAT" | "VEG";
  isRetrain: boolean;
};

/** 解析第 i 位參加者的欄位；回傳 null 表示整列留空（略過） */
function parseAttendee(
  formData: FormData,
  i: number,
): ParsedAttendee | { error: string } | null {
  const name = String(formData.get(`attendee-${i}-name`) ?? "").trim();
  const phoneRaw = String(formData.get(`attendee-${i}-phone`) ?? "").trim();
  const email = String(formData.get(`attendee-${i}-email`) ?? "").trim().toLowerCase();
  const mealRaw = String(formData.get(`attendee-${i}-meal`) ?? "");
  const isRetrain = formData.get(`attendee-${i}-retrain`) === "on";

  if (!name && !phoneRaw && !email) return null;
  const who = name || `第 ${i + 1} 位參加者`;
  if (!name) return { error: `請填寫第 ${i + 1} 位參加者的姓名` };

  // 同行者鐵則：每位參加者都要留自己的手機。訂購人幫同行者填自己的號碼，
  // 是學員記錄卡把兩個人併成一張卡的主因，在表單這一層就擋掉最省事。
  if (!phoneRaw) return { error: `請填寫「${who}」本人的手機（每位參加者要留自己的號碼）` };
  const { mobile, reject, overseas } = explainMobile(phoneRaw);
  if (!mobile && !overseas) {
    return {
      error: `「${who}」的手機${reject ? `：${MOBILE_REJECT_LABEL[reject]}` : "格式不正確"}（請填 09 開頭 10 碼，海外門號請加國碼如 +60123456789）`,
    };
  }
  if (email && !EMAIL_RE.test(email)) return { error: `「${who}」的 Email 格式不正確` };

  return {
    name,
    phone: mobile ?? overseas!,
    email: email || null,
    meal: mealRaw === "VEG" ? "VEG" : "MEAT", // 白名單，預設葷
    isRetrain,
  };
}

export async function submitSignupAction(
  slug: string,
  _prev: PublicSignupState,
  formData: FormData,
): Promise<PublicSignupState> {
  // 蜜罐：真人看不到的欄位有值 = 機器人，裝作成功不寫入。
  // 欄位名沿用講座頁那個 autofill 字典外的怪名（曾因取名 website 被瀏覽器自動填入誤殺真人）
  if (String(formData.get("hp_extra_note") ?? "").trim() !== "") {
    console.error("[session-signup] 蜜罐觸發（機器人或 autofill 誤填）", { slug });
    return { success: "報名已送出，確認信將寄到你的信箱！" };
  }

  // 代稱存檔時一律小寫；網址可能帶大寫，比對前正規化（同 /event/[slug] 頁面）
  const session = await prisma.courseSession.findUnique({
    where: { signupSlug: slug.toLowerCase() },
  });
  if (!session) return { error: "找不到這個報名頁" };

  const buyerEmail = String(formData.get("buyerEmail") ?? "").trim().toLowerCase();
  if (!EMAIL_RE.test(buyerEmail)) return { error: "請填寫正確的 Email（報名確認信會寄到這裡）" };
  const note = String(formData.get("note") ?? "").trim() || null;

  const attendees: ParsedAttendee[] = [];
  for (let i = 0; i < MAX_ATTENDEES; i++) {
    const parsed = parseAttendee(formData, i);
    if (parsed === null) continue;
    if ("error" in parsed) return { error: parsed.error };
    attendees.push(parsed);
  }
  if (attendees.length === 0) return { error: "請至少填寫一位參加者" };

  // 同一次報名內自己撞名（同名同手機）：多半是重複填寫，直接擋掉
  for (let i = 1; i < attendees.length; i++) {
    if (attendees.slice(0, i).some((a) => isSamePerson(a, attendees[i]))) {
      return { error: `「${attendees[i].name}」在這次報名中重複填寫了` };
    }
  }

  // 開放與名額判定：已確認名單（未延出）＋ 待確認申請都算佔位
  const [roster, pendingCount, recentDup] = await Promise.all([
    prisma.sessionSignup.findMany({
      where: { sessionId: session.id, deferredToSessionId: null },
      select: { name: true, phone: true },
    }),
    prisma.sessionSignupRequest.count({
      where: { sessionId: session.id, status: SIGNUP_REQUEST_STATUS.PENDING },
    }),
    prisma.sessionSignupRequest.findFirst({
      where: {
        sessionId: session.id,
        buyerEmail,
        status: SIGNUP_REQUEST_STATUS.PENDING,
        createdAt: { gt: new Date(Date.now() - DUP_WINDOW_MS) },
      },
      select: { id: true },
    }),
  ]);

  // 連點兩次送出：不再寫一筆，直接回成功（使用者看到的結果與第一次相同）
  if (recentDup) return { success: "報名已送出，確認信將寄到你的信箱！" };

  const state = signupState({
    session,
    taken: roster.length + pendingCount,
    now: new Date(),
  });
  if (!state.open) return { error: CLOSED_MESSAGE[state.reason] };

  const remaining =
    session.signupQuota === null
      ? Infinity
      : session.signupQuota - roster.length - pendingCount;
  if (attendees.length > remaining) {
    return {
      error:
        remaining <= 0
          ? "本場次名額已滿"
          : `本場次只剩 ${remaining} 個名額，無法一次報名 ${attendees.length} 位`,
    };
  }

  // 已在名單裡的人（含已確認與待確認）不重複報名
  const pendingPeople = await prisma.sessionSignupRequest.findMany({
    where: { sessionId: session.id, status: SIGNUP_REQUEST_STATUS.PENDING },
    select: { name: true, phone: true },
  });
  const existing = [...roster, ...pendingPeople];
  for (const a of attendees) {
    const dup = existing.find((r) => isSamePerson(r, a));
    if (dup) {
      return {
        error: `「${a.name}」已經報名過這個場次了。若確定是同名的不同人，請確認手機號碼填的是本人的`,
      };
    }
  }

  const orderNo = makeWebOrderNo();
  const buyer = attendees[0];

  try {
    await prisma.sessionSignupRequest.createMany({
      data: attendees.map((a, i) => ({
        sessionId: session.id,
        orderNo,
        attendeeKey: attendeeKeyAt(i),
        name: a.name,
        email: a.email,
        phone: a.phone,
        meal: a.meal,
        isRetrain: a.isRetrain,
        buyerName: buyer.name,
        buyerEmail,
        buyerPhone: buyer.phone,
        note: i === 0 ? note : null, // 備註只記在訂購人那列
      })),
    });
  } catch (e) {
    console.error("[session-signup] 報名寫入失敗", { slug, orderNo, e });
    return { error: "報名送出失敗，請稍後再試或直接與我們聯繫" };
  }

  // 自動加入名單群組（失敗不影響報名成立）
  if (session.signupGroupId) {
    try {
      await prisma.mailGroupMember.upsert({
        where: { groupId_email: { groupId: session.signupGroupId, email: buyerEmail } },
        update: { name: buyer.name },
        create: { groupId: session.signupGroupId, email: buyerEmail, name: buyer.name },
      });
    } catch (e) {
      console.error("[session-signup] 加入名單群組失敗", { slug, buyerEmail, e });
    }
  }

  await sendSignupConfirmation(session, orderNo, buyerEmail, buyer.name, attendees);

  revalidatePath(`/admin/sessions/${session.id}/signup-page`);
  return {
    success: `報名已送出！我們已將確認信寄到 ${buyerEmail}，請依信中說明完成繳費。`,
  };
}

/** 報名確認信：附繳費說明。寄不出去不影響報名成立（後台看得到這筆），只記 log。 */
async function sendSignupConfirmation(
  session: {
    title: string;
    eventDate: Date | null;
    venue: string | null;
    address: string | null;
    signupPriceNote: string | null;
    signupPayNote: string | null;
  },
  orderNo: string,
  buyerEmail: string,
  buyerName: string,
  attendees: ParsedAttendee[],
): Promise<void> {
  const when = session.eventDate
    ? session.eventDate.toLocaleDateString("zh-TW", {
        timeZone: "Asia/Taipei",
        year: "numeric",
        month: "long",
        day: "numeric",
      })
    : null;
  const lines = [
    `${buyerName} 您好，感謝您報名「${session.title}」！`,
    "",
    "## 報名資訊",
    `報名編號：${orderNo}`,
    ...(when ? [`上課日期：${when}`] : []),
    ...(session.venue ? [`上課地點：${session.venue}`] : []),
    ...(session.address ? [`地　　址：${session.address}`] : []),
    `參加人數：${attendees.length} 位（${attendees.map((a) => a.name).join("、")}）`,
    ...(session.signupPriceNote ? [`費　　用：${session.signupPriceNote}`] : []),
    "",
    "---",
    "",
    "## 完成繳費",
    session.signupPayNote ??
      "我們將盡快與您聯繫確認繳費方式。若三個工作天內未收到通知，請直接回信詢問。",
    "",
    "**收到款項後我們會再寄一封確認信，報名才算完成。**",
    "",
    "希望學院 敬上",
  ];

  const html = buildBroadcastHtml(lines.join("\n"), null, null, "NOTICE");
  const result = await sendBroadcast(
    [{ email: buyerEmail, name: buyerName }],
    `【報名已收到】${session.title}`,
    () => html,
  );
  if (result.sent === 0) {
    console.error("[session-signup] 報名確認信寄送失敗", {
      orderNo,
      buyerEmail,
      error: result.error,
    });
  }
}

// ───────────────────── 後台：確認收款 → 轉入名單 ─────────────────────

/** 把一筆報名申請（整張訂單的所有參加者）轉入 SessionSignup 正式名單。
 *  轉入後才會出現在看板、分組、簽到表與課前通知的名單裡。 */
export async function confirmSignupRequestAction(
  sessionId: string,
  orderNo: string,
): Promise<SignupPageState> {
  await requireEditor();

  const requests = await prisma.sessionSignupRequest.findMany({
    where: { sessionId, orderNo, status: SIGNUP_REQUEST_STATUS.PENDING },
    orderBy: { attendeeKey: "asc" },
  });
  if (requests.length === 0) return { error: "找不到待確認的報名（可能已處理過）" };

  let moved = 0;
  for (const r of requests) {
    // 報名時自稱複訓 → 沿用全站統一的舊生判別（product 含「複訓」）
    const base = "網路報名";
    const product = r.isRetrain && !isRetrainProduct(base) ? `複訓｜${base}` : base;
    try {
      const signup = await prisma.sessionSignup.create({
        data: {
          sessionId,
          orderNo: r.orderNo,
          attendeeKey: r.attendeeKey,
          name: r.name,
          email: r.email,
          phone: r.phone,
          product,
          meal: r.meal,
          orderedAt: r.createdAt,
        },
      });
      await prisma.sessionSignupRequest.update({
        where: { id: r.id },
        data: {
          status: SIGNUP_REQUEST_STATUS.CONFIRMED,
          confirmedAt: new Date(),
          signupId: signup.id,
        },
      });
      moved++;
    } catch (e) {
      // 唯一鍵撞到＝這個人已在名單裡（可能先前手動加過），標成已確認即可，不重複建列
      console.error("[session-signup] 轉入名單失敗", { orderNo, name: r.name, e });
      await prisma.sessionSignupRequest.update({
        where: { id: r.id },
        data: { status: SIGNUP_REQUEST_STATUS.CONFIRMED, confirmedAt: new Date() },
      });
    }
  }

  revalidatePath(`/admin/sessions/${sessionId}/signup-page`);
  revalidatePath("/admin/sessions");
  revalidatePath("/board");
  return { success: `已將 ${moved} 位轉入正式名單` };
}

/** 取消報名申請（未到款、重複報名）。不刪列，保留紀錄可追。 */
export async function cancelSignupRequestAction(
  sessionId: string,
  orderNo: string,
): Promise<SignupPageState> {
  await requireEditor();
  const { count } = await prisma.sessionSignupRequest.updateMany({
    where: { sessionId, orderNo, status: SIGNUP_REQUEST_STATUS.PENDING },
    data: { status: SIGNUP_REQUEST_STATUS.CANCELLED },
  });
  if (count === 0) return { error: "找不到待確認的報名（可能已處理過）" };
  revalidatePath(`/admin/sessions/${sessionId}/signup-page`);
  return { success: `已取消 ${count} 筆報名申請` };
}
