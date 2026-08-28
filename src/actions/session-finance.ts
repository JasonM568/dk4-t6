"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requireFullAdmin } from "@/lib/auth/staff";
import { getAuthUser } from "@/lib/supabase/server";
import { roundNT } from "@/lib/finance/compute";
import { normalizePaymentMethod } from "@/lib/finance/labels";
import {
  FINANCE_SETTING_KEYS,
  setFinanceSetting,
  type InternalShareSetting,
} from "@/lib/finance/settings";

// 場次收支的後台 actions。此檔只能 export async 函式（常數在 lib/finance/labels.ts）。
// 權限：一律 requireFullAdmin（僅管理員）——分潤金額是內部薪酬，
// 操作人員（operator）不可讀寫；頁面與匯出 route 同一標準。
//
// 通則：
// 1. 任何動到「訂單金額/認列/分類」的編輯都把該訂單標 manualOverride=true——
//    重匯只更新追溯欄位，人工判斷不會被覆蓋。
// 2. LOCKED 場次一律拒改（結算數字凍結）。
// 3. 金額用整數元；比例輸入用 %（可一位小數），存 ppm。

export type FinanceFormState = { error?: string; success?: string } | null;

const FINANCE_PATHS = (sessionId: string) => [
  `/admin/sessions/${sessionId}/finance`,
  "/admin/sessions",
];

function revalidateFinance(sessionId: string) {
  for (const p of FINANCE_PATHS(sessionId)) revalidatePath(p);
}

/** 共同守門：場次存在且未結算 */
async function guardSession(sessionId: string): Promise<string | null> {
  const fin = await prisma.sessionFinance.findUnique({
    where: { sessionId },
    select: { status: true },
  });
  if (fin?.status === "LOCKED")
    return "本場已結算鎖定，數字已凍結。要修改請先解除鎖定";
  return null;
}

/** 逐明細列改認列金額（組合方案只認列本場那一段）。0 也是合法值；負數不收 */
export async function setLineRecognitionAction(
  lineId: string,
  recognizedAmountRaw: string,
  note: string,
): Promise<FinanceFormState> {
  await requireFullAdmin();
  const recognizedAmount = Math.round(Number(recognizedAmountRaw));
  if (!Number.isFinite(recognizedAmount) || recognizedAmount < 0)
    return { error: "認列金額須為 0 以上的整數" };

  const line = await prisma.sessionOrderLine.findUnique({
    where: { id: lineId },
    select: { id: true, amount: true, order: { select: { id: true, sessionId: true } } },
  });
  if (!line) return { error: "找不到這條明細（可能剛被重匯重建），請重新整理" };
  const locked = await guardSession(line.order.sessionId);
  if (locked) return { error: locked };
  if (recognizedAmount > line.amount)
    return { error: `認列金額不可超過付款金額 ${line.amount}` };

  await prisma.$transaction([
    prisma.sessionOrderLine.update({
      where: { id: lineId },
      data: {
        recognizedAmount,
        recognizeNote: note.trim().slice(0, 200) || null,
      },
    }),
    // 人工判斷保護：重匯不得覆蓋
    prisma.sessionOrder.update({
      where: { id: line.order.id },
      data: { manualOverride: true },
    }),
  ]);
  revalidateFinance(line.order.sessionId);
  return { success: "已更新認列金額" };
}

/** 逐明細列改新生/複訓分類（AUTO = 回到依產品名自動判斷） */
export async function setLineStudentTypeAction(
  lineId: string,
  type: string,
): Promise<FinanceFormState> {
  await requireFullAdmin();
  if (!["AUTO", "NEW", "RETRAIN"].includes(type)) return { error: "分類不正確" };
  const line = await prisma.sessionOrderLine.findUnique({
    where: { id: lineId },
    select: { order: { select: { id: true, sessionId: true } } },
  });
  if (!line) return { error: "找不到這條明細，請重新整理" };
  const locked = await guardSession(line.order.sessionId);
  if (locked) return { error: locked };

  await prisma.$transaction([
    prisma.sessionOrderLine.update({
      where: { id: lineId },
      data: { studentType: type === "AUTO" ? null : type },
    }),
    prisma.sessionOrder.update({
      where: { id: line.order.id },
      data: { manualOverride: true },
    }),
  ]);
  revalidateFinance(line.order.sessionId);
  return { success: "已更新分類" };
}

/** 訂單整張認列/不認列（分期未繳完、特殊個案暫不分潤） */
export async function setOrderRecognizedAction(
  orderId: string,
  recognized: boolean,
  reason: string,
): Promise<FinanceFormState> {
  await requireFullAdmin();
  const order = await prisma.sessionOrder.findUnique({
    where: { id: orderId },
    select: { sessionId: true },
  });
  if (!order) return { error: "找不到這張訂單，請重新整理" };
  const locked = await guardSession(order.sessionId);
  if (locked) return { error: locked };

  await prisma.sessionOrder.update({
    where: { id: orderId },
    data: {
      isRecognized: recognized,
      excludeReason: recognized ? null : reason.trim().slice(0, 200) || "人工排除",
      manualOverride: true,
    },
  });
  revalidateFinance(order.sessionId);
  return { success: recognized ? "已恢復認列" : "已排除認列" };
}

/** 手動新增收入（現場收現金、無訂單編號的款項）。
 *  與線上訂單同一張收入明細，isOnsite 只標示來源。 */
export async function addManualIncomeAction(
  sessionId: string,
  _prev: FinanceFormState,
  formData: FormData,
): Promise<FinanceFormState> {
  await requireFullAdmin();
  const locked = await guardSession(sessionId);
  if (locked) return { error: locked };

  const admin = await getAuthUser();
  const name = String(formData.get("name") ?? "").trim();
  const unitPrice = Math.round(Number(formData.get("unitPrice")));
  const quantity = Math.round(Number(formData.get("quantity") ?? 1)) || 1;
  const payRaw = String(formData.get("paymentMethod") ?? "CASH");
  const studentType = String(formData.get("studentType") ?? "NEW");
  const isOnsite = formData.get("isOnsite") === "on";
  const note = String(formData.get("note") ?? "").trim();

  if (!name) return { error: "請填寫姓名／名目" };
  if (!Number.isFinite(unitPrice) || unitPrice < 0) return { error: "單價須為 0 以上整數" };
  if (quantity < 1 || quantity > 99) return { error: "數量須為 1–99" };
  if (!["CREDIT_ONE", "CREDIT_INSTALLMENT", "ATM", "CASH", "OTHER"].includes(payRaw))
    return { error: "付款方式不正確" };
  if (!["NEW", "RETRAIN"].includes(studentType)) return { error: "分類不正確" };

  const session = await prisma.courseSession.findUnique({
    where: { id: sessionId },
    select: { id: true },
  });
  if (!session) return { error: "找不到場次" };

  const amount = unitPrice * quantity;
  const orderNo = `${isOnsite ? "ONSITE" : "MANUAL"}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  await prisma.sessionOrder.create({
    data: {
      sessionId,
      orderNo,
      source: isOnsite ? "ONSITE" : "MANUAL",
      buyerName: name,
      paymentMethod: payRaw,
      seats: quantity,
      manualOverride: true, // 手建的列永不被匯入覆蓋
      note: note || null,
      createdBy: admin?.email ?? null,
      lines: {
        create: {
          productRaw: note || (isOnsite ? "現場收款" : "手動收入"),
          planLabel: isOnsite ? "現場收款" : "手動收入",
          studentType,
          unitPrice,
          quantity,
          amount,
          recognizedAmount: amount,
          isOnsite,
          sortOrder: 0,
        },
      },
    },
  });
  revalidateFinance(sessionId);
  return { success: `已新增收入 ${name} NT$${amount.toLocaleString("zh-TW")}` };
}

/** 刪除手動收入（只允許 MANUAL/ONSITE；1shop 匯入的訂單用「排除認列」而非刪除） */
export async function deleteManualOrderAction(orderId: string): Promise<FinanceFormState> {
  await requireFullAdmin();
  const order = await prisma.sessionOrder.findUnique({
    where: { id: orderId },
    select: { sessionId: true, source: true },
  });
  if (!order) return { error: "找不到這筆收入" };
  if (order.source === "IMPORT")
    return { error: "1shop 匯入的訂單不可刪除——要排除請用「不認列」，紀錄才追得回來" };
  const locked = await guardSession(order.sessionId);
  if (locked) return { error: locked };

  await prisma.sessionOrder.delete({ where: { id: orderId } });
  revalidateFinance(order.sessionId);
  return { success: "已刪除" };
}

/** 新增支出（固定型手填 / 外部分潤 / 覆寫自動科目）。
 *  外部分潤：金額 = ROUND(基準金額 × 比例)；覆寫自動科目：帶 code，同 code 自動列讓位 */
export async function addCostAction(
  sessionId: string,
  _prev: FinanceFormState,
  formData: FormData,
): Promise<FinanceFormState> {
  await requireFullAdmin();
  const locked = await guardSession(sessionId);
  if (locked) return { error: locked };

  const kind = String(formData.get("kind") ?? "FIXED");
  const label = String(formData.get("label") ?? "").trim();
  const note = String(formData.get("note") ?? "").trim();
  const code = String(formData.get("code") ?? "").trim() || null;
  if (!["FIXED", "EXTERNAL_SHARE", "RATE"].includes(kind)) return { error: "類型不正確" };
  if (!label) return { error: "請填寫費用項目名稱" };

  let amount: number;
  let basisText: string | null = null;
  let basisAmount: number | null = null;
  let ratePpm: number | null = null;
  let payee: string | null = null;

  if (kind === "EXTERNAL_SHARE") {
    // 外部分潤 = 指定金額（毛收）× %，列為支出先扣
    payee = String(formData.get("payee") ?? "").trim() || null;
    basisAmount = Math.round(Number(formData.get("basisAmount")));
    const ratePct = Number(formData.get("ratePct"));
    if (!Number.isFinite(basisAmount) || basisAmount <= 0)
      return { error: "請填寫分潤基準金額（該講師課程的毛收）" };
    if (!Number.isFinite(ratePct) || ratePct <= 0 || ratePct > 100)
      return { error: "比例須為 0–100 的百分比" };
    ratePpm = Math.round(ratePct * 10_000);
    amount = roundNT((basisAmount * ratePpm) / 1_000_000);
    basisText = `${basisAmount.toLocaleString("zh-TW")} × ${ratePct}%`;
  } else {
    amount = Math.round(Number(formData.get("amount")));
    if (!Number.isFinite(amount) || amount < 0) return { error: "金額須為 0 以上整數" };
    basisText = String(formData.get("basisText") ?? "").trim() || null;
  }

  const max = await prisma.sessionCost.aggregate({
    where: { sessionId },
    _max: { sortOrder: true },
  });
  await prisma.sessionCost.create({
    data: {
      sessionId,
      kind,
      code,
      label,
      basisText,
      basisAmount,
      ratePpm,
      amount,
      isAuto: false, // 人工列：重算永不動；帶 code 時同 code 自動列讓位
      payee,
      note: note || null,
      sortOrder: (max._max.sortOrder ?? -1) + 1,
    },
  });
  revalidateFinance(sessionId);
  return { success: `已新增支出「${label}」` };
}

/** 改支出金額／名稱（僅人工列；自動列要改請先「覆寫」成人工列） */
export async function updateCostAction(
  costId: string,
  labelRaw: string,
  amountRaw: string,
): Promise<FinanceFormState> {
  await requireFullAdmin();
  const label = labelRaw.trim();
  const amount = Math.round(Number(amountRaw));
  if (!label) return { error: "名稱不可空白" };
  if (!Number.isFinite(amount) || amount < 0) return { error: "金額須為 0 以上整數" };

  const cost = await prisma.sessionCost.findUnique({
    where: { id: costId },
    select: { sessionId: true, isAuto: true },
  });
  if (!cost) return { error: "找不到這筆支出，請重新整理" };
  if (cost.isAuto) return { error: "自動計算的科目請用「覆寫」建立人工列" };
  const locked = await guardSession(cost.sessionId);
  if (locked) return { error: locked };

  await prisma.sessionCost.update({
    where: { id: costId },
    data: { label, amount },
  });
  revalidateFinance(cost.sessionId);
  return { success: "已更新" };
}

export async function deleteCostAction(costId: string): Promise<FinanceFormState> {
  await requireFullAdmin();
  const cost = await prisma.sessionCost.findUnique({
    where: { id: costId },
    select: { sessionId: true },
  });
  if (!cost) return null;
  const locked = await guardSession(cost.sessionId);
  if (locked) return { error: locked };
  await prisma.sessionCost.delete({ where: { id: costId } });
  revalidateFinance(cost.sessionId);
  return { success: "已刪除" };
}

/** 儲存本場的內部分潤名單（整組取代）。
 *  比例合計不強制 100%（單一講師 100%、刻意保留比例都合法），警告由畫面顯示 */
export async function saveSharesAction(
  sessionId: string,
  rowsJson: string,
): Promise<FinanceFormState> {
  await requireFullAdmin();
  const locked = await guardSession(sessionId);
  if (locked) return { error: locked };

  let rows: { name: string; pct: number }[];
  try {
    rows = JSON.parse(rowsJson);
  } catch {
    return { error: "資料格式錯誤" };
  }
  if (!Array.isArray(rows) || rows.length > 20) return { error: "分潤名單格式錯誤" };
  const clean: { name: string; ppm: number }[] = [];
  const seen = new Set<string>();
  for (const r of rows) {
    const name = String(r?.name ?? "").trim();
    const pct = Number(r?.pct);
    if (!name) return { error: "分潤對象姓名不可空白" };
    if (seen.has(name)) return { error: `分潤對象「${name}」重複` };
    seen.add(name);
    if (!Number.isFinite(pct) || pct < 0 || pct > 100)
      return { error: `「${name}」的比例須為 0–100` };
    clean.push({ name, ppm: Math.round(pct * 10_000) });
  }

  await prisma.$transaction([
    prisma.sessionProfitShare.deleteMany({ where: { sessionId } }),
    prisma.sessionProfitShare.createMany({
      data: clean.map((r, i) => ({
        sessionId,
        payeeName: r.name,
        sharePpm: r.ppm,
        amount: 0, // 顯示值一律由 compute 即時算；此欄於結算鎖定時寫入快照
        sortOrder: i,
      })),
    }),
  ]);
  revalidateFinance(sessionId);
  return { success: "已儲存分潤比例" };
}

/** 儲存費率設定（/admin/sessions/finance/settings）。輸入用 %，存 ppm */
export async function saveFinanceSettingsAction(
  _prev: FinanceFormState,
  formData: FormData,
): Promise<FinanceFormState> {
  await requireFullAdmin();

  const pctFields: [keyof typeof FINANCE_SETTING_KEYS, string][] = [
    ["invoiceTaxPpm", "invoiceTaxPct"],
    ["incomeTaxPpm", "incomeTaxPct"],
    ["cardFeePpm", "cardFeePct"],
    ["cardInstallFeePpm", "cardInstallFeePct"],
    ["atmFeePpm", "atmFeePct"],
  ];
  for (const [key, field] of pctFields) {
    const pct = Number(String(formData.get(field) ?? "").trim());
    if (!Number.isFinite(pct) || pct < 0 || pct > 50)
      return { error: `費率「${field}」須為 0–50 的百分比` };
    await setFinanceSetting(key, String(Math.round(pct * 10_000)));
  }
  for (const [key, field, max] of [
    ["atmUnitFee", "atmUnitFee", 1000],
    ["remitUnitFee", "remitUnitFee", 1000],
  ] as const) {
    const n = Math.round(Number(String(formData.get(field) ?? "").trim()));
    if (!Number.isFinite(n) || n < 0 || n > max)
      return { error: `「${field}」須為 0–${max} 的整數` };
    await setFinanceSetting(key, String(n));
  }
  const atmMode = String(formData.get("atmMode") ?? "UNIT");
  await setFinanceSetting("atmMode", atmMode === "RATE" ? "RATE" : "UNIT");

  // 預設內部分潤（新場次的起始值；已設定的場次不受影響）
  const sharesJson = String(formData.get("sharesJson") ?? "");
  try {
    const rows = JSON.parse(sharesJson) as { name: string; pct: number }[];
    const clean: InternalShareSetting[] = [];
    for (const r of rows) {
      const name = String(r?.name ?? "").trim();
      const pct = Number(r?.pct);
      if (!name || !Number.isFinite(pct) || pct < 0 || pct > 100)
        return { error: "預設分潤名單有誤（姓名不可空白、比例 0–100）" };
      clean.push({ name, ppm: Math.round(pct * 10_000) });
    }
    if (clean.length === 0) return { error: "預設分潤至少要有一位" };
    await setFinanceSetting("internalShares", JSON.stringify(clean));
  } catch {
    return { error: "預設分潤資料格式錯誤" };
  }

  revalidatePath("/admin/sessions/finance/settings");
  revalidatePath("/admin/sessions");
  return { success: "已儲存費率與預設分潤（已結算的場次不受影響）" };
}

/** 財務補匯：只寫金額、完全不碰名單（歷史場次補資料／同場修正金額用） */
export async function uploadFinanceOnlyAction(
  _prev: FinanceFormState,
  formData: FormData,
): Promise<FinanceFormState> {
  await requireFullAdmin();
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return { error: "請選擇訂單檔案" };
  if (file.size > 10 * 1024 * 1024) return { error: "檔案請小於 10MB" };

  const { importOrders } = await import("@/lib/session-import");
  try {
    const report = await importOrders(await file.arrayBuffer(), {
      mode: "financeOnly",
      sourceFile: file.name,
    });
    const f = report.finance;
    revalidatePath("/admin/sessions");
    const skipped =
      f.skippedOverride.length + f.skippedLocked.length > 0
        ? `；${f.skippedOverride.length + f.skippedLocked.length} 張因人工調整/已結算未覆蓋`
        : "";
    return {
      success: `金額補匯完成：寫入 ${f.ordersUpserted} 張訂單、${f.linesWritten} 條明細${skipped}（名單完全未動）`,
    };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "解析失敗，請確認檔案格式" };
  }
}

/** 把某產品原文的方案顯示名存成全域對照（之後每次匯入自動套用） */
export async function savePlanAliasAction(
  productRaw: string,
  planLabel: string,
): Promise<FinanceFormState> {
  await requireFullAdmin();
  const admin = await getAuthUser();
  const raw = productRaw.trim();
  const label = planLabel.trim();
  if (!raw) return { error: "產品原文不可空白" };
  if (!label) {
    await prisma.financePlanAlias.deleteMany({ where: { productRaw: raw } });
    return { success: "已移除對照，回復顯示原文" };
  }
  await prisma.financePlanAlias.upsert({
    where: { productRaw: raw },
    update: { planLabel: label, updatedBy: admin?.email ?? null },
    create: { productRaw: raw, planLabel: label, updatedBy: admin?.email ?? null },
  });
  return { success: `已設定「${label}」（之後匯入自動套用）` };
}
