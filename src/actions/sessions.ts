"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requireEditor } from "@/lib/auth/staff";
import { importOrders, type ImportReport } from "@/lib/session-import";
import { explainMobile, normalizeMobile, MOBILE_REJECT_LABEL } from "@/lib/sms/phone";
import { findStudentByPhone } from "@/lib/student-history";
import { isRetrainProduct, assignGroups, assignRemaining, type Meal } from "@/lib/session-roster";

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

  // 手機選填；但填了就一定要是能收簡訊的號碼——存進去卻發不出簡訊比留空更糟
  let phone: string | null = null;
  if (phoneInput) {
    const { mobile, reject } = explainMobile(phoneInput);
    if (!mobile)
      return {
        error: `手機${reject ? `：${MOBILE_REJECT_LABEL[reject]}` : "格式不正確"}（請填 09 開頭 10 碼，或留空）`,
      };
    phone = mobile;
  }

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
      select: { attendeeKey: true, name: true },
    });
    if (existing.some((e) => e.name === name))
      return { error: `${name} 已在這張訂單的名單裡` };
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

  const attendees = rows.flatMap((r) =>
    r.attendees.map((attendee) => {
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
        phone:
          attendee.key === "buyer"
            ? normalizeMobile(r.phone)
            : normalizeMobile(attendee.phone ?? null),
        product,
        amount: typeof r.amount === "number" ? r.amount : null,
        orderedAt: orderedAt && !Number.isNaN(orderedAt.getTime()) ? orderedAt : null,
        // meal 經前端 JSON 來回，白名單收斂防竄改
        meal:
          attendee.key === "buyer" && (r.meal === "VEG" || r.meal === "MEAT") ? r.meal : null,
      };
    }),
  );
  const res = await prisma.sessionSignup.createMany({
    data: attendees,
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
    select: { id: true, deferredToSessionId: true },
  });
  if (targetRow?.deferredToSessionId)
    return { error: "對方場次那筆又再延期了，請先到該場次取消後續延期" };

  await prisma.$transaction([
    ...(targetRow ? [prisma.sessionSignup.delete({ where: { id: targetRow.id } })] : []),
    prisma.sessionSignup.update({
      where: { id: signup.id },
      data: { deferredToSessionId: null },
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
