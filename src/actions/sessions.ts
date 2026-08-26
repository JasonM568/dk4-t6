"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requireEditor } from "@/lib/auth/staff";
import { importOrders, type ImportReport } from "@/lib/session-import";
import { explainMobile, normalizeContactPhone, MOBILE_REJECT_LABEL } from "@/lib/sms/phone";
import { findStudentByPhone } from "@/lib/student-history";
import { getProfilesByIds, searchProfiles } from "@/lib/supabase/admin";
import { isSearchableQuery } from "@/lib/roster-search";
import {
  isRetrainProduct,
  assignGroups,
  assignRemaining,
  isSamePerson,
  type Meal,
} from "@/lib/session-roster";

// 課程場次看板：後台管理 actions（場次 CRUD / 訂單匯入 / 看板 4 位碼）

export type SessionFormState = { error?: string; success?: string } | null;
export type UploadState =
  | { error?: string; report?: ImportReport }
  | null;

const MAX_UPLOAD_BYTES = 10 * 1024 * 1024; // 與 next.config bodySizeLimit 12mb 保持餘裕

/** 解析場次表單共同欄位 */
function parseSessionForm(formData: FormData) {
  const title = String(formData.get("title") ?? "").trim();
  const dateStr = String(formData.get("eventDate") ?? "").trim();
  const endStr = String(formData.get("endDate") ?? "").trim();
  const keywords = String(formData.get("keywords") ?? "")
    .split(/[,，\n]/)
    .map((k) => k.trim())
    .filter(Boolean);
  const adminNote = String(formData.get("adminNote") ?? "").trim();
  const isVisible = formData.get("isVisible") === "on";
  const eventDate = dateStr ? new Date(dateStr) : null;
  if (eventDate && Number.isNaN(eventDate.getTime()))
    return { error: "開課日期格式錯誤" as const };
  const endDate = endStr ? new Date(endStr) : null;
  if (endDate && Number.isNaN(endDate.getTime()))
    return { error: "結束日期格式錯誤" as const };
  if (endDate && eventDate && endDate < eventDate)
    return { error: "結束日不能早於開課日" as const };
  if (adminNote.length > 5_000) return { error: "場次備忘錄不可超過 5,000 字" as const };
  return { title, eventDate, endDate, keywords, isVisible, adminNote: adminNote || null };
}

export async function createSessionAction(
  _prev: SessionFormState,
  formData: FormData,
): Promise<SessionFormState> {
  await requireEditor();
  const parsed = parseSessionForm(formData);
  if ("error" in parsed) return { error: parsed.error };
  if (!parsed.title) return { error: "請填寫場次名稱" };
  if (parsed.keywords.length === 0)
    return { error: "請至少填一個產品關鍵字（訂單歸類依據）" };

  await prisma.courseSession.create({ data: parsed });
  revalidatePath("/admin/sessions");
  return { success: `已建立場次「${parsed.title}」` };
}

export async function updateSessionAction(
  id: string,
  _prev: SessionFormState,
  formData: FormData,
): Promise<SessionFormState> {
  await requireEditor();
  const parsed = parseSessionForm(formData);
  if ("error" in parsed) return { error: parsed.error };
  if (!parsed.title) return { error: "請填寫場次名稱" };

  await prisma.courseSession.update({ where: { id }, data: parsed });
  revalidatePath("/admin/sessions");
  revalidatePath("/board");
  return { success: "已更新" };
}

/** 刪除場次（連同報名紀錄，客戶端先 confirm） */
export async function deleteSessionAction(id: string) {
  await requireEditor();
  await prisma.courseSession.delete({ where: { id } }).catch(() => undefined);
  revalidatePath("/admin/sessions");
  revalidatePath("/board");
}

/** 手動新增報名（電話報名/現金/特殊訂單等，不經訂單檔） */
export async function addSignupAction(
  sessionId: string,
  _prev: SessionFormState,
  formData: FormData,
): Promise<SessionFormState> {
  await requireEditor();
  const name = String(formData.get("name") ?? "").trim();
  const orderNoInput = String(formData.get("orderNo") ?? "").trim();
  const note = String(formData.get("note") ?? "").trim();
  const phoneInput = String(formData.get("phone") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const type = String(formData.get("type"));
  const isRetrain = type === "retrain";
  const isStaff = type === "staff"; // 工作人員：不分組、不算新舊生，用餐要算
  const confirmOldStudent = formData.get("confirmOldStudent") === "on";
  const mealInput = String(formData.get("meal") ?? "");
  const meal: Meal = mealInput === "VEG" ? "VEG" : "MEAT"; // 白名單，預設葷
  if (!name) return { error: "請填寫姓名" };
  if (email && !email.includes("@")) return { error: "Email 格式不正確" };

  // 手機選填；但填了就一定要是能收簡訊的號碼——存進去卻發不出簡訊比留空更糟。
  // 海外門號例外：存 E.164，名單上標成「海外·Email」。
  // 留空與存海外號差很多——留空是「不知道怎麼聯絡他」，存海外號是
  // 「知道他是誰、只是要改用 Email 通知」，寄通知的人需要看得出這個差別。
  let phone: string | null = null;
  if (phoneInput) {
    const { mobile, reject, overseas } = explainMobile(phoneInput);
    if (!mobile && !overseas)
      return {
        error: `手機${reject ? `：${MOBILE_REJECT_LABEL[reject]}` : "格式不正確"}（請填 09 開頭 10 碼、海外門號加國碼如 +60123456789，或留空）`,
      };
    phone = mobile ?? overseas!;
  }

  // 同場次同一人只能有一列（跨訂單編號的重複＝名單最常見的髒資料來源）。
  // 判定同匯入端：姓名相同且手機不衝突；延出者不算（人不來這場了，可重新報名）
  const roster = await prisma.sessionSignup.findMany({
    where: { sessionId, deferredToSessionId: null },
    select: { name: true, phone: true, orderNo: true },
  });
  const already = roster.find((r) => isSamePerson(r, { name, phone }));
  if (already)
    return {
      error: `${name} 已在這個場次的名單裡（訂單 ${already.orderNo}）。若確定是同名的不同人，請填上他本人的手機，或在姓名加註記（例：${name}2）再送出`,
    };

  // 舊生資格核對改用手機（Email 常見夫妻／親子共用，對不到本人）。
  // 資料庫查無這支號碼時不硬擋——學員資料庫是逐步累積的，勾「確認為舊生」
  // 即一併建檔，下次同一支號碼就查得到。
  if (isRetrain) {
    if (!phone) return { error: "選擇複訓方案時請填寫學員手機以核對舊生資格" };
    const oldStudent = await findStudentByPhone(phone);
    if (!oldStudent) {
      if (!confirmOldStudent)
        return {
          error: "學員資料庫查無這支手機。確認本人是舊生的話，請勾選「確認為舊生，一併建檔」再送出",
        };
      await prisma.studentRecord.create({
        data: { phone, name, email: email || null },
      });
    } else if (!oldStudent.name || (email && !oldStudent.email)) {
      // 順手補齊資料庫缺的姓名／Email，不覆蓋既有值
      await prisma.studentRecord.update({
        where: { id: oldStudent.id },
        data: {
          name: oldStudent.name ?? name,
          email: oldStudent.email ?? (email || null),
        },
      });
    }
  }

  // 沒填訂單編號就生一組「手動-」流水（orderNo 是場次內冪等鍵，不能留空）
  const orderNo =
    orderNoInput || `手動-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

  // 兩人同報常見同一張訂單號（黃淑華＋李舜泰實例）：同單第二位起改用 manual-N
  // 識別鍵，不會撞唯一鍵；manual- 前綴也永不與匯入產生的 companion-N 相撞。
  let attendeeKey = "buyer";
  if (orderNoInput) {
    const existing = await prisma.sessionSignup.findMany({
      where: { sessionId, orderNo: orderNoInput },
      select: { attendeeKey: true },
    });
    if (existing.length > 0) {
      const keys = new Set(existing.map((e) => e.attendeeKey));
      let n = 1;
      while (keys.has(`manual-${n}`)) n++;
      attendeeKey = `manual-${n}`;
    }
  }

  // 舊生判別全站統一（isRetrainProduct）——選舊生就自動補上「複訓」標記
  const base = note || (isStaff ? "工作人員" : "手動新增");
  const product = isRetrain && !isRetrainProduct(base) ? `複訓｜${base}` : base;

  try {
    await prisma.sessionSignup.create({
      data: {
        sessionId,
        orderNo,
        attendeeKey,
        name,
        email: email || null,
        phone,
        product,
        meal,
        isStaff,
        orderedAt: new Date(),
      },
    });
  } catch {
    return { error: `訂單編號 ${orderNo} 已在這個場次的名單裡` };
  }
  revalidatePath("/admin/sessions");
  revalidatePath("/board");
  return { success: `已加入 ${name}` };
}

/** 把「對不到關鍵字」的訂單列歸入管理員指定的場次。
 *
 *  來源是 uploadOrdersAction 回傳報告裡的 unmatched rows（課程改名時
 *  整批對不到，如量子課 3~6 月叫「人生升級」）。冪等：同單同場次只算一筆，
 *  重複歸類不會重複計數。可選擇同時把產品名加入場次關鍵字，之後再傳同名
 *  訂單檔就會自動歸類，不必再問一次。 */
export async function assignUnmatchedAction(
  _prev: SessionFormState,
  formData: FormData,
): Promise<SessionFormState> {
  await requireEditor();
  const sessionId = String(formData.get("sessionId") ?? "");
  const product = String(formData.get("product") ?? "").trim();
  const addKeyword = formData.get("addKeyword") === "on";
  if (!sessionId) return { error: "請選擇要歸入的場次" };
  if (!product) return { error: "缺少產品名稱" };

  // rows 來自上傳報告經前端 hidden input 帶回，防禦性解析：壞資料擋下不寫入
  let rows: {
    orderNo: string;
    name: string;
    email: string | null;
    phone: string | null;
    amount: number | null;
    orderedAt: string | null;
    meal?: string | null;
    seats?: number | null;
    attendees: { key: string; name: string; phone?: string | null; email?: string | null }[];
  }[];
  try {
    const parsed: unknown = JSON.parse(String(formData.get("rows") ?? "[]"));
    if (!Array.isArray(parsed) || parsed.length === 0 || parsed.length > 2000)
      return { error: "名單資料不完整，請重新上傳訂單檔" };
    rows = parsed.filter(
      (r): r is (typeof rows)[number] =>
        !!r && typeof r === "object" &&
        typeof (r as { orderNo?: unknown }).orderNo === "string" &&
        !!(r as { orderNo: string }).orderNo &&
        typeof (r as { name?: unknown }).name === "string" &&
        !!(r as { name: string }).name &&
        Array.isArray((r as { attendees?: unknown }).attendees) &&
        (r as { attendees: unknown[] }).attendees.every(
          (a) => !!a && typeof a === "object" &&
            typeof (a as { key?: unknown }).key === "string" &&
            typeof (a as { name?: unknown }).name === "string" &&
            !!(a as { name: string }).name,
        ),
    );
    if (rows.length === 0) return { error: "名單資料不完整，請重新上傳訂單檔" };
  } catch {
    return { error: "名單資料不完整，請重新上傳訂單檔" };
  }

  const session = await prisma.courseSession.findUnique({
    where: { id: sessionId },
    select: { id: true, title: true, keywords: true },
  });
  if (!session) return { error: "場次不存在（可能剛被刪除），請重新選擇" };

  const attendees = rows.flatMap((r) => {
    // 席次規則同匯入端：訂購人佔 1 席，同行者最多 席次-1 位。
    // 只買 1 席卻填了同行者＝「跟誰一起上課」，對方多半自己下單，不建列。
    // seats 經前端 JSON 來回，非正整數一律當「檔案沒有數量欄」→ 維持全收。
    const seats = typeof r.seats === "number" && Number.isInteger(r.seats) && r.seats > 0 ? r.seats : null;
    const list = seats === null
      ? r.attendees
      : [
          ...r.attendees.filter((a) => a.key === "buyer"),
          ...r.attendees
            .filter((a) => a.key !== "buyer")
            .slice(0, Math.max(0, seats - 1))
            .map((a, i) => ({ ...a, key: `companion-${i + 1}` })),
        ];
    return list.map((attendee) => {
      const orderedAt = r.orderedAt ? new Date(r.orderedAt) : null;
      return {
        sessionId: session.id,
        orderNo: r.orderNo,
        attendeeKey: attendee.key,
        name: attendee.name,
        // 同行者電話/信箱走重新收斂（JSON 來回不信原值）
        email:
          attendee.key === "buyer"
            ? r.email || null
            : typeof attendee.email === "string" && attendee.email.includes("@")
              ? attendee.email.trim().toLowerCase()
              : null,
        // 海外學員訂單填的是 +60... 之類：normalizeMobile 會回 null，
        // 若不接住就整個掉成「無手機」，這個人在名單上會變成聯絡不到的空白
        phone:
          attendee.key === "buyer"
            ? normalizeContactPhone(r.phone)
            : normalizeContactPhone(attendee.phone ?? null),
        product,
        amount: typeof r.amount === "number" ? r.amount : null,
        orderedAt: orderedAt && !Number.isNaN(orderedAt.getTime()) ? orderedAt : null,
        // meal 經前端 JSON 來回，白名單收斂防竄改
        meal:
          attendee.key === "buyer" && (r.meal === "VEG" || r.meal === "MEAT") ? r.meal : null,
      };
    });
  });
  // 同場次同一人跨訂單編號的重複（同匯入端規則）：擋掉，不建新列
  const roster = await prisma.sessionSignup.findMany({
    where: { sessionId: session.id, deferredToSessionId: null },
    select: { name: true, phone: true, orderNo: true, attendeeKey: true },
  });
  const people = roster.map((r) => ({ name: r.name, phone: r.phone, orderNo: r.orderNo }));
  const tripleKeys = new Set(roster.map((r) => `${r.orderNo}|${r.attendeeKey}`));
  const kept = attendees.filter((a) => {
    if (tripleKeys.has(`${a.orderNo}|${a.attendeeKey}`)) return true; // 交給 skipDuplicates 計數
    if (people.some((p) => isSamePerson(p, a))) return false;
    people.push({ name: a.name, phone: a.phone, orderNo: a.orderNo });
    return true;
  });
  const res = await prisma.sessionSignup.createMany({
    data: kept,
    skipDuplicates: true,
  });

  // 同時補關鍵字：之後上傳同名產品的訂單檔就自動歸類，不必再問
  if (addKeyword && !session.keywords.includes(product)) {
    await prisma.courseSession.update({
      where: { id: session.id },
      data: { keywords: { push: product } },
    });
  }

  revalidatePath("/admin/sessions");
  revalidatePath("/board");
  const dup = attendees.length - res.count;
  return {
    success: `已把「${product}」${res.count} 筆歸入「${session.title}」${
      dup > 0 ? `（${dup} 筆已在名單略過）` : ""
    }${addKeyword ? "，並已加入場次關鍵字" : ""}`,
  };
}

/** 移除單筆報名（誤歸類等，客戶端先 confirm） */
export async function removeSignupAction(id: string) {
  await requireEditor();
  await prisma.sessionSignup.delete({ where: { id } }).catch(() => undefined);
  revalidatePath("/admin/sessions");
  revalidatePath("/board");
}

/** 逐人改姓名（學員常填英文名，管理員手動標註中文；重匯不會覆蓋——
 *  匯入對既有列一律 skipDuplicates 不更新） */
export async function setSignupNameAction(id: string, name: string) {
  await requireEditor();
  const value = name.trim().slice(0, 60);
  if (!value) return; // 不准清成空白
  await prisma.sessionSignup
    .update({ where: { id }, data: { name: value } })
    .catch(() => undefined);
  revalidatePath("/admin/sessions");
  revalidatePath("/board");
}

/** 逐人補手機（團報名單匯入時整批沒號碼，管理員事後補；重匯不會覆蓋——
 *  匯入對既有列一律 skipDuplicates 不更新）。
 *  空字串 = 清成未填（號碼填錯時要能拿掉，不然錯號會一直收到提醒簡訊）。 */
export async function setSignupPhoneAction(id: string, phone: string) {
  await requireEditor();
  const input = phone.trim();
  let value: string | null = null;
  if (input) {
    // 同 addSignupAction：存得進去卻發不出簡訊，比留空更糟；海外門號存 E.164
    const { mobile, reject, overseas } = explainMobile(input);
    if (!mobile && !overseas)
      return {
        error: `手機${reject ? `：${MOBILE_REJECT_LABEL[reject]}` : "格式不正確"}（請填 09 開頭 10 碼、海外門號加國碼如 +60123456789，或清空）`,
      };
    value = mobile ?? overseas!;
  }
  await prisma.sessionSignup
    .update({ where: { id }, data: { phone: value } })
    .catch(() => undefined);
  revalidatePath("/admin/sessions");
  revalidatePath("/board");
}

/** 逐人改身分：新生 / 舊生（複訓）/ 工作人員。
 *
 *  訂單買錯方案、家人代訂、事後才查出是舊生等情況，光靠產品名判不出來——
 *  這裡寫進 isRetrain 覆寫欄（判別統一走 isRetrainSignup），product 原值不動保留追溯。
 *  選到與產品名自動判別相同的值就存回 null（回歸自動判斷），不留無意義的覆寫。
 *  改成工作人員會一併清掉組別（工作人員不列入分組）；原本的新舊生覆寫保留，
 *  改回學員時直接復原。 */
export async function setSignupTypeAction(id: string, type: "fresh" | "retrain" | "staff") {
  await requireEditor();
  if (type !== "fresh" && type !== "retrain" && type !== "staff") return; // 白名單
  if (type === "staff") {
    await prisma.sessionSignup
      .update({ where: { id }, data: { isStaff: true, groupNo: null } })
      .catch(() => undefined);
  } else {
    const signup = await prisma.sessionSignup.findUnique({
      where: { id },
      select: { product: true },
    });
    if (!signup) return;
    const want = type === "retrain";
    await prisma.sessionSignup
      .update({
        where: { id },
        data: {
          isStaff: false,
          isRetrain: want === isRetrainProduct(signup.product) ? null : want,
        },
      })
      .catch(() => undefined);
  }
  revalidatePath("/admin/sessions");
  revalidatePath("/board");
}

/** 逐人切換葷素（後台名單表格；匯入未標或同行者由這裡補） */
export async function setSignupMealAction(id: string, meal: Meal | null) {
  await requireEditor();
  const value = meal === "VEG" || meal === "MEAT" ? meal : null; // 白名單
  await prisma.sessionSignup
    .update({ where: { id }, data: { meal: value } })
    .catch(() => undefined);
  revalidatePath("/admin/sessions");
  revalidatePath("/board");
}

/** 逐組人數上限覆寫（0 = 清除覆寫、改用場次預設）；場地桌子大小不一時用 */
export async function setGroupCapAction(sessionId: string, groupNo: number, cap: number) {
  await requireEditor();
  if (!Number.isInteger(groupNo) || groupNo < 1 || groupNo > 99) return;
  const value = Number.isInteger(cap) && cap >= 1 && cap <= 99 ? cap : 0;
  const session = await prisma.courseSession.findUnique({
    where: { id: sessionId },
    select: { groupCaps: true },
  });
  if (!session) return;
  const caps = [...session.groupCaps];
  while (caps.length < groupNo) caps.push(0);
  caps[groupNo - 1] = value;
  // 尾端的 0 修掉，陣列不無限增長
  while (caps.length > 0 && caps[caps.length - 1] === 0) caps.pop();
  await prisma.courseSession.update({ where: { id: sessionId }, data: { groupCaps: caps } });
  revalidatePath("/admin/sessions");
}

/** 手動指定單人組別（自動分組後的微調；null = 改回未分組） */
export async function setSignupGroupAction(id: string, groupNo: number | null) {
  await requireEditor();
  const value =
    typeof groupNo === "number" && Number.isInteger(groupNo) && groupNo >= 1 && groupNo <= 99
      ? groupNo
      : null;
  await prisma.sessionSignup
    .update({ where: { id }, data: { groupNo: value } })
    .catch(() => undefined);
  revalidatePath("/admin/sessions");
  revalidatePath("/board");
}

/** 自動分組。mode=all：全量重分（覆蓋手動調整，前端 confirm）；
 *  mode=fill：只補「未分組」的人進現有組（每日更新名單後的新報名），已分好的不動。
 *  每組上限一併存回場次。 */
export async function autoGroupAction(
  sessionId: string,
  _prev: SessionFormState,
  formData: FormData,
): Promise<SessionFormState> {
  await requireEditor();
  const cap = Math.floor(Number(formData.get("cap")));
  if (!Number.isFinite(cap) || cap < 1 || cap > 99)
    return { error: "每組人數上限請填 1〜99" };
  const fillOnly = String(formData.get("mode")) === "fill";

  const [session, signups] = await Promise.all([
    prisma.courseSession.findUnique({ where: { id: sessionId }, select: { groupCaps: true } }),
    prisma.sessionSignup.findMany({
      where: { sessionId },
      select: {
        id: true, product: true, deferredToSessionId: true, orderedAt: true, createdAt: true,
        groupNo: true, isStaff: true,
      },
    }),
  ]);
  const groupCaps = session?.groupCaps ?? [];
  if (signups.every((s) => s.deferredToSessionId || s.isStaff))
    return { error: "沒有可分組的學員" };

  const { assignments, groupCount } = fillOnly
    ? assignRemaining(signups, cap, groupCaps)
    : assignGroups(signups, cap, groupCaps);
  if (fillOnly && assignments.size === 0) return { error: "沒有未分組的學員" };
  // 反轉成「組 → 成員 id 清單」，一組一個 updateMany，交易內一次寫完
  const byGroup = new Map<number, string[]>();
  for (const [id, groupNo] of assignments) {
    byGroup.set(groupNo, [...(byGroup.get(groupNo) ?? []), id]);
  }
  await prisma.$transaction([
    prisma.courseSession.update({ where: { id: sessionId }, data: { groupCap: cap } }),
    ...[...byGroup.entries()].map(([groupNo, ids]) =>
      prisma.sessionSignup.updateMany({ where: { id: { in: ids } }, data: { groupNo } }),
    ),
    // 延出者與工作人員不佔組
    prisma.sessionSignup.updateMany({
      where: { sessionId, OR: [{ deferredToSessionId: { not: null } }, { isStaff: true }] },
      data: { groupNo: null },
    }),
  ]);
  revalidatePath("/admin/sessions");
  revalidatePath("/board");
  return {
    success: fillOnly
      ? `已把 ${assignments.size} 位未分組學員補進各組（現共 ${groupCount} 組）`
      : `已分成 ${groupCount} 組（共 ${assignments.size} 人）`,
  };
}

/** 延期：原列保留並標記（排除於統計/分組/看板/簡訊），目標場次建新列。
 *  新列刻意沿用原 orderNo+attendeeKey——1shop 退款的全域刪除（importOrders
 *  的 deleteMany by orderNo）會連延期列一併清掉：退款＝人不來了，正確。 */
export async function deferSignupAction(
  _prev: SessionFormState,
  formData: FormData,
): Promise<SessionFormState> {
  await requireEditor();
  const signupId = String(formData.get("signupId") ?? "");
  const targetSessionId = String(formData.get("targetSessionId") ?? "");
  if (!signupId || !targetSessionId) return { error: "請選擇要延期到的場次" };

  const signup = await prisma.sessionSignup.findUnique({ where: { id: signupId } });
  if (!signup) return { error: "報名紀錄不存在（可能剛被移除）" };
  if (signup.deferredToSessionId) return { error: "這筆報名已經延期過了" };
  if (signup.sessionId === targetSessionId) return { error: "不能延期到同一場次" };
  const target = await prisma.courseSession.findUnique({
    where: { id: targetSessionId },
    select: { id: true, title: true },
  });
  if (!target) return { error: "目標場次不存在（可能剛被刪除）" };

  try {
    await prisma.$transaction([
      prisma.sessionSignup.create({
        data: {
          sessionId: target.id,
          orderNo: signup.orderNo,
          attendeeKey: signup.attendeeKey,
          name: signup.name,
          email: signup.email,
          phone: signup.phone,
          product: signup.product,
          amount: signup.amount,
          orderedAt: signup.orderedAt,
          meal: signup.meal,
          isStaff: signup.isStaff,
          groupNo: null,
          deferredFromSessionId: signup.sessionId,
        },
      }),
      prisma.sessionSignup.update({
        where: { id: signup.id },
        data: { deferredToSessionId: target.id, groupNo: null },
      }),
    ]);
  } catch (e) {
    if ((e as { code?: string }).code === "P2002")
      return { error: `${signup.name} 已在「${target.title}」的名單裡` };
    throw e;
  }
  revalidatePath("/admin/sessions");
  revalidatePath("/board");
  return { success: `已把 ${signup.name} 延期到「${target.title}」` };
}

/** 取消延期：刪除目標場次那筆、原列復原。
 *  鏈式延期（A→B→C）只准從尾端取消，避免中間斷鏈留孤兒列。 */
export async function undoDeferSignupAction(signupId: string): Promise<SessionFormState> {
  await requireEditor();
  const signup = await prisma.sessionSignup.findUnique({ where: { id: signupId } });
  if (!signup?.deferredToSessionId) return { error: "這筆報名沒有延期紀錄" };

  const targetRow = await prisma.sessionSignup.findUnique({
    where: {
      sessionId_orderNo_attendeeKey: {
        sessionId: signup.deferredToSessionId,
        orderNo: signup.orderNo,
        attendeeKey: signup.attendeeKey,
      },
    },
    select: { id: true, deferredToSessionId: true, meal: true, phone: true },
  });
  if (targetRow?.deferredToSessionId)
    return { error: "對方場次那筆又再延期了，請先到該場次取消後續延期" };

  await prisma.$transaction([
    ...(targetRow ? [prisma.sessionSignup.delete({ where: { id: targetRow.id } })] : []),
    prisma.sessionSignup.update({
      where: { id: signup.id },
      data: {
        deferredToSessionId: null,
        // 延期期間在對方場次改過的葷素／手機要帶回來，否則人回到原場次、
        // 便當數卻還是延期前的舊值（原列在延出期間是唯讀的，改不到）
        ...(targetRow ? { meal: targetRow.meal, phone: targetRow.phone } : {}),
      },
    }),
  ]);
  revalidatePath("/admin/sessions");
  revalidatePath("/board");
  return { success: `已取消 ${signup.name} 的延期` };
}

/** 上傳 1shop 訂單檔 → 解析歸類匯入 */
export async function uploadOrdersAction(
  _prev: UploadState,
  formData: FormData,
): Promise<UploadState> {
  await requireEditor();
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0)
    return { error: "請選擇訂單檔（1shop 匯出的 .xlsx 或 .csv）" };
  if (file.size > MAX_UPLOAD_BYTES)
    return { error: "檔案超過 10MB，請確認是否選錯檔案" };
  // 副檔名允許清單（實際檔型另由 parseOrderFile 的 magic bytes 判定，不信 MIME）
  if (!/\.(xlsx|csv)$/i.test(file.name))
    return { error: "只接受 .xlsx 或 .csv 檔（1shop 匯出的訂單檔）" };

  try {
    const report = await importOrders(await file.arrayBuffer());
    revalidatePath("/admin/sessions");
    revalidatePath("/board");
    return { report };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "解析失敗，請確認檔案格式" };
  }
}

// ── 手動新增報名的「找人」搜尋 ──

/** 一位候選人。sources = 這個人在系統裡的哪些地方出現過（讓管理員判斷是不是同一人）。 */
export type AttendeeCandidate = {
  name: string;
  phone: string | null;
  email: string | null;
  isMember: boolean; // 是否為已註冊會員
  sources: string[];
};

/** 各來源各自命中幾筆——搜不到人時，這組數字能立刻分辨是「這個人不在系統裡」
 *  還是「某個來源根本沒回資料」。沒有它就只能猜。 */
export type AttendeeSearchResult = {
  candidates: AttendeeCandidate[];
  counts: { members: number; signups: number; students: number };
  /** 合併去重後的總數（可能多於回傳的 candidates） */
  total: number;
};

const CANDIDATE_LIMIT = 12;

export const EMPTY_ATTENDEE_SEARCH: AttendeeSearchResult = {
  candidates: [],
  counts: { members: 0, signups: 0, students: 0 },
  total: 0,
};

/** 手動新增報名時的「找人」：輸入姓名／手機／Email 的一部分，把系統裡已有的人撈出來。
 *
 *  資料來源刻意是這三個，理由是命中率：
 *    會員（QBC profiles，647 筆）      姓名／Email 搜得到，但只有少數人填過手機
 *    既有場次名單（SessionSignup）      1shop 訂單匯進來的，手機最齊全
 *    學員資料庫（StudentRecord）        歷史學員，目前幾乎是空的但查了不虧
 *
 *  合併規則：手機優先當識別鍵（夫妻／親子共用信箱在實務上很常見，用 email 當鍵會把
 *  兩個人併成一個），沒手機才退回 email，都沒有才用姓名。
 *  這與 session-roster 的 isSamePerson 是同一套思路。 */
export async function searchAttendeeAction(
  query: string,
): Promise<AttendeeSearchResult> {
  await requireEditor();
  const q = query.trim();
  // 中文一個字（姓氏）就查得有意義，英數要兩個字元；與客戶端同一支判斷
  if (!isSearchableQuery(q)) return EMPTY_ATTENDEE_SEARCH;

  const lower = q.toLowerCase();
  // 輸入看起來像號碼就一併用正規化後的樣子去比對（09-1234-5678 / +886912345678）
  const asPhone = normalizeContactPhone(q);
  const digits = q.replace(/\D/g, "");
  const contains = { contains: q, mode: "insensitive" as const };

  const [profiles, signups, students, memberPhones] = await Promise.all([
    searchProfiles(q, 20),
    prisma.sessionSignup.findMany({
      where: {
        OR: [
          { name: contains },
          { email: contains },
          ...(digits.length >= 3
            ? [{ phone: { contains: digits } }, ...(asPhone ? [{ phone: asPhone }] : [])]
            : []),
        ],
      },
      select: {
        name: true,
        phone: true,
        email: true,
        session: { select: { title: true } },
      },
      orderBy: { createdAt: "desc" },
      take: 40,
    }),
    prisma.studentRecord.findMany({
      where: {
        OR: [
          { name: contains },
          { email: contains },
          ...(digits.length >= 3 ? [{ phone: { contains: digits } }] : []),
        ],
      },
      select: { name: true, phone: true, email: true },
      take: 20,
    }),
    // 會員的手機在 course schema，profiles 裡沒有；用手機搜時要靠這張表才找得到會員
    digits.length >= 3
      ? prisma.memberProfile.findMany({
          where: { phone: { contains: digits } },
          select: { userId: true, phone: true },
          take: 20,
        })
      : Promise.resolve([]),
  ]);

  // 用手機命中的會員，回頭補他的姓名與 email
  const phoneMemberProfiles = memberPhones.length
    ? await getProfilesByIds(memberPhones.map((m) => m.userId))
    : [];
  const phoneByUserId = new Map(memberPhones.map((m) => [m.userId, m.phone]));

  // 會員 email → 手機（讓姓名搜到的會員也帶得出號碼）
  const memberEmails = profiles.map((p) => p.email).filter((e): e is string => !!e);
  const emailToPhone = new Map<string, string>();
  if (memberEmails.length > 0) {
    const ids = profiles.filter((p) => p.email).map((p) => p.id);
    const rows = await prisma.memberProfile.findMany({
      where: { userId: { in: ids } },
      select: { userId: true, phone: true },
    });
    const byId = new Map(rows.map((r) => [r.userId, r.phone]));
    for (const p of profiles) {
      const ph = byId.get(p.id);
      if (p.email && ph) emailToPhone.set(p.email.toLowerCase(), ph);
    }
  }

  const merged = new Map<string, AttendeeCandidate>();
  const add = (c: {
    name: string;
    phone?: string | null;
    email?: string | null;
    isMember?: boolean;
    source: string;
  }) => {
    const name = c.name?.trim();
    if (!name) return;
    const phone = c.phone?.trim() || null;
    const email = c.email?.trim().toLowerCase() || null;
    // 手機 > email > 姓名：共用信箱的兩個人不能被併成一筆
    const key = phone ? `p:${phone}` : email ? `e:${email}` : `n:${name}`;
    const cur = merged.get(key);
    if (!cur) {
      merged.set(key, {
        name,
        phone,
        email,
        isMember: !!c.isMember,
        sources: [c.source],
      });
      return;
    }
    // 已有的欄位不覆蓋，只補空的——先進來的來源比較可靠（會員資料 > 訂單名單）
    cur.phone ??= phone;
    cur.email ??= email;
    cur.isMember ||= !!c.isMember;
    if (!cur.sources.includes(c.source)) cur.sources.push(c.source);
  };

  for (const p of profiles) {
    add({
      name: p.display_name || p.nickname || p.email || "",
      email: p.email,
      phone: p.email ? (emailToPhone.get(p.email.toLowerCase()) ?? null) : null,
      isMember: true,
      source: "會員",
    });
  }
  for (const p of phoneMemberProfiles) {
    add({
      name: p.display_name || p.nickname || p.email || "",
      email: p.email,
      phone: phoneByUserId.get(p.id) ?? null,
      isMember: true,
      source: "會員",
    });
  }
  for (const s of signups) {
    add({
      name: s.name,
      phone: s.phone,
      email: s.email,
      source: `曾報名「${s.session.title}」`,
    });
  }
  for (const s of students) {
    add({
      name: s.name ?? "",
      phone: s.phone,
      email: s.email,
      source: "學員資料庫",
    });
  }

  // 完全比中的排前面（打全名/全號碼時最想要的那筆不該被埋在下面）
  const score = (c: AttendeeCandidate) =>
    (c.name.toLowerCase() === lower || c.phone === asPhone ? 0 : 1) +
    (c.isMember ? 0 : 0.5);
  const all = [...merged.values()].sort((a, b) => score(a) - score(b));

  return {
    candidates: all.slice(0, CANDIDATE_LIMIT),
    // 回各來源的原始命中數（未去重）：0 代表那個來源真的沒東西，
    // 而不是被合併或被截斷掉——搜不到人時這是唯一能分辨的依據
    counts: {
      members: profiles.length + phoneMemberProfiles.length,
      signups: signups.length,
      students: students.length,
    },
    total: all.length,
  };
}

// ── 上課連結（/live 憑碼索取）──

/** 產生一組沒被別的場次用掉的 4 位上課碼。
 *  10000 組空間、實際同時開放的場次只有個位數，碰撞機率極低；
 *  仍然重試而不是硬寫入，因為 accessCode 是唯一鍵，撞到就是一個 500。 */
async function generateAccessCode(): Promise<string | null> {
  for (let i = 0; i < 30; i++) {
    // 0000 與 1234 這種太好猜的不發（學員會手打，但也別送分給亂試的人）
    const code = String(Math.floor(Math.random() * 9000) + 1000);
    if (/^(\d)\1{3}$/.test(code)) continue; // 1111、2222…
    const taken = await prisma.courseSession.findUnique({
      where: { accessCode: code },
      select: { id: true },
    });
    if (!taken) return code;
  }
  return null;
}

/** 儲存這場的上課連結設定。填了會議連結但還沒有上課碼時自動配一組。
 *  清空會議連結 = 關閉索取：連上課碼一起清掉，已發出的 cookie 立刻失效
 *  （live-auth 驗簽時會重新撈碼，碼沒了就驗不過）。 */
export async function saveSessionLiveAction(
  sessionId: string,
  _prev: SessionFormState,
  formData: FormData,
): Promise<SessionFormState> {
  await requireEditor();
  const session = await prisma.courseSession.findUnique({
    where: { id: sessionId },
    select: { id: true, title: true, accessCode: true },
  });
  if (!session) return { error: "找不到這個場次（可能剛被刪除）" };

  const meetingUrl = String(formData.get("meetingUrl") ?? "").trim();
  const meetingId = String(formData.get("meetingId") ?? "").trim();
  const meetingPassword = String(formData.get("meetingPassword") ?? "").trim();
  const meetingInfo = String(formData.get("meetingInfo") ?? "").trim();
  const codeInput = String(formData.get("accessCode") ?? "").trim();
  const regenerate = formData.get("regenerate") === "1";

  if (meetingInfo.length > 5_000) return { error: "課程資料不可超過 5,000 字" };
  if (meetingUrl) {
    // 只收 http(s)：頁面上會渲染成可點連結，javascript:／data: 一律擋在入口
    let ok = false;
    try {
      const u = new URL(meetingUrl);
      ok = u.protocol === "http:" || u.protocol === "https:";
    } catch {
      ok = false;
    }
    if (!ok)
      return { error: "會議連結請填完整網址（以 https:// 開頭）" };
  }

  // 沒有連結就沒有東西可看：連碼一起清掉，別留一組進去只看到空白的碼
  if (!meetingUrl) {
    await prisma.courseSession.update({
      where: { id: sessionId },
      data: {
        meetingUrl: null,
        meetingId: null,
        meetingPassword: null,
        meetingInfo: meetingInfo || null,
        accessCode: null,
      },
    });
    revalidatePath("/admin/sessions");
    revalidatePath("/live");
    return {
      success: `已關閉「${session.title}」的上課連結索取（上課碼已作廢）`,
    };
  }

  let accessCode = session.accessCode;
  if (regenerate || !accessCode) {
    const next = await generateAccessCode();
    if (!next) return { error: "上課碼產生失敗（可用組合已滿），請稍後再試" };
    accessCode = next;
  } else if (codeInput && codeInput !== accessCode) {
    // 管理員手動指定碼（想用好記的號碼）
    if (!/^\d{4}$/.test(codeInput)) return { error: "上課碼須為 4 位數字" };
    const taken = await prisma.courseSession.findUnique({
      where: { accessCode: codeInput },
      select: { id: true },
    });
    if (taken && taken.id !== sessionId)
      return { error: `上課碼 ${codeInput} 已被其他場次使用，請換一組` };
    accessCode = codeInput;
  }

  await prisma.courseSession.update({
    where: { id: sessionId },
    data: {
      meetingUrl,
      meetingId: meetingId || null,
      meetingPassword: meetingPassword || null,
      meetingInfo: meetingInfo || null,
      accessCode,
    },
  });
  revalidatePath("/admin/sessions");
  revalidatePath("/live");
  return {
    success:
      `已儲存。學員到 course.huangxi.info/live 輸入上課碼 ${accessCode} 即可看到連結` +
      (regenerate || accessCode !== session.accessCode
        ? "（上課碼已更新，舊碼與已開啟的頁面立即失效）"
        : ""),
  };
}

// 與 email/dispatch.ts 同一條規則：TLD 至少 2 個字母
const GROUP_EMAIL_RE = /^[^\s@]+@[^\s@]+\.[a-zA-Z]{2,}$/;

/** 把這一場的報名者存成 EDM 名單群組（同名群組＝併入，群組內 email 重複自動略過）。
 *
 *  這是「快照」，用途是日後行銷（課後回訪、招下一期）——名單存下來就不再跟著場次變動。
 *  **課前通知不要用這個**：EDM 群發直接選「場次報名者」即可，名單於寄出當下解析，
 *  發完才報名、事後才補 Email 的人都會自動涵蓋，不會寄到一份過期名單。 */
export async function saveSessionToMailGroupAction(
  sessionId: string,
  _prev: SessionFormState,
  formData: FormData,
): Promise<SessionFormState> {
  await requireEditor();
  const session = await prisma.courseSession.findUnique({
    where: { id: sessionId },
    select: { id: true, title: true },
  });
  if (!session) return { error: "找不到這個場次（可能剛被刪除）" };

  const name = String(formData.get("groupName") ?? "").trim() || session.title;
  if (name.length > 100) return { error: "群組名稱不可超過 100 字" };

  const signups = await prisma.sessionSignup.findMany({
    // 已延期到別場的不算這場的人（與 EDM／簡訊發送時的名單條件一致）
    where: { sessionId, deferredToSessionId: null },
    select: { email: true, name: true },
    orderBy: { createdAt: "asc" },
  });

  const seen = new Set<string>();
  const rows = signups
    .map((s) => ({ email: (s.email ?? "").trim().toLowerCase(), name: s.name.trim() }))
    .filter((r) => GROUP_EMAIL_RE.test(r.email))
    .filter((r) => !seen.has(r.email) && seen.add(r.email));

  if (rows.length === 0)
    return { error: "這場的報名者都沒有留 Email，沒有可存入群組的名單" };

  const group = await prisma.mailGroup.upsert({
    where: { name },
    update: {},
    create: { name },
  });
  const created = await prisma.mailGroupMember.createMany({
    data: rows.map((r) => ({ groupId: group.id, email: r.email, name: r.name || null })),
    skipDuplicates: true, // 群組內 email 唯一：重按一次不會長出重複列
  });

  revalidatePath("/admin/sessions");
  revalidatePath("/admin/broadcast/groups");
  const skipped = signups.length - rows.length;
  return {
    success:
      `已存入名單群組「${name}」：新增 ${created.count} 筆` +
      (created.count < rows.length ? `（${rows.length - created.count} 筆原本就在群組裡）` : "") +
      (skipped > 0 ? `；${skipped} 人沒有可用 Email 或重複報名，未存入` : "") +
      `。這是當下的名單快照，之後新報名者不會自動加入——課前通知請改用 EDM 群發的「場次報名者」。`,
  };
}

/** 看板設定：4 位碼＋登入時效（存 SiteSetting；改碼即讓所有既有看板 cookie 失效） */
export async function saveBoardCodeAction(
  _prev: SessionFormState,
  formData: FormData,
): Promise<SessionFormState> {
  await requireEditor();
  const code = String(formData.get("code") ?? "").trim();
  const hours = Math.round(Number(String(formData.get("hours") ?? "").trim()));
  if (!/^\d{4}$/.test(code)) return { error: "登入碼須為 4 位數字" };
  if (!Number.isFinite(hours) || hours < 1 || hours > 24)
    return { error: "登入時效須為 1–24 小時" };
  await prisma.$transaction([
    prisma.siteSetting.upsert({
      where: { key: "boardCode" },
      update: { value: code },
      create: { key: "boardCode", value: code },
    }),
    prisma.siteSetting.upsert({
      where: { key: "boardSessionHours" },
      update: { value: String(hours) },
      create: { key: "boardSessionHours", value: String(hours) },
    }),
  ]);
  revalidatePath("/admin/sessions");
  return {
    success: `看板設定已更新：登入後 ${hours} 小時自動登出（時效變更只影響之後的登入；改碼則立即全面登出）`,
  };
}
