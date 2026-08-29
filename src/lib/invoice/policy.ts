import { prisma } from "@/lib/db";

// 發票開立時機政策（存 SiteSetting key-value，後台「發票設定」頁維護）：
//   AUTO_PAID  完款就開立（預設）——金流結算成功即自動開
//   MANUAL     手動開立——一律由管理員在訂單詳情按「開立發票」
//   ON_STATUS  按訂單狀態開立——訂單被標成指定狀態（已確認/已完成）時自動開
// 讀不到設定一律回預設值，政策表壞掉不能讓付款流程跟著壞。

export const INVOICE_MODE_KEY = "invoice:mode";
export const INVOICE_STATUS_KEY = "invoice:trigger_status";

export const INVOICE_MODES = ["AUTO_PAID", "MANUAL", "ON_STATUS"] as const;
export type InvoiceMode = (typeof INVOICE_MODES)[number];

export const INVOICE_MODE_LABEL: Record<InvoiceMode, string> = {
  AUTO_PAID: "完款就開立",
  MANUAL: "手動開立",
  ON_STATUS: "按訂單狀態開立",
};

/** ON_STATUS 模式可選的觸發狀態（都是付款後的營運態） */
export const INVOICE_TRIGGER_STATUSES = ["CONFIRMED", "COMPLETED"] as const;

export type InvoicePolicy = {
  mode: InvoiceMode;
  /** ON_STATUS 模式的觸發狀態；其他模式忽略 */
  triggerStatus: (typeof INVOICE_TRIGGER_STATUSES)[number];
};

export async function getInvoicePolicy(): Promise<InvoicePolicy> {
  try {
    const rows = await prisma.siteSetting.findMany({
      where: { key: { in: [INVOICE_MODE_KEY, INVOICE_STATUS_KEY] } },
    });
    const get = (k: string) => rows.find((r) => r.key === k)?.value;
    const mode = get(INVOICE_MODE_KEY);
    const status = get(INVOICE_STATUS_KEY);
    return {
      mode: (INVOICE_MODES as readonly string[]).includes(mode ?? "")
        ? (mode as InvoiceMode)
        : "AUTO_PAID",
      triggerStatus: (INVOICE_TRIGGER_STATUSES as readonly string[]).includes(status ?? "")
        ? (status as InvoicePolicy["triggerStatus"])
        : "CONFIRMED",
    };
  } catch (e) {
    console.error("[invoice] 讀取開立政策失敗，使用預設（完款就開立）", e);
    return { mode: "AUTO_PAID", triggerStatus: "CONFIRMED" };
  }
}

export async function setInvoicePolicy(policy: InvoicePolicy): Promise<void> {
  await prisma.$transaction([
    prisma.siteSetting.upsert({
      where: { key: INVOICE_MODE_KEY },
      update: { value: policy.mode },
      create: { key: INVOICE_MODE_KEY, value: policy.mode },
    }),
    prisma.siteSetting.upsert({
      where: { key: INVOICE_STATUS_KEY },
      update: { value: policy.triggerStatus },
      create: { key: INVOICE_STATUS_KEY, value: policy.triggerStatus },
    }),
  ]);
}
