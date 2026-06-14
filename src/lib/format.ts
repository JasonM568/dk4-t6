/** 把整數金額（新台幣元）格式化成 NT$1,234 */
export function formatNT(amount: number): string {
  return "NT$" + amount.toLocaleString("zh-TW");
}

/** 把秒數格式化成「X 小時 Y 分」/「Y 分 Z 秒」/「Z 秒」（觀看時長顯示用） */
export function formatDuration(totalSec: number): string {
  const sec = Math.max(0, Math.floor(totalSec));
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  if (h > 0) return `${h} 小時 ${m} 分`;
  if (m > 0) return `${m} 分 ${s} 秒`;
  return `${s} 秒`;
}

export function formatDate(date: Date | string): string {
  const d = typeof date === "string" ? new Date(date) : date;
  return d.toLocaleString("zh-TW", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** 開通來源標籤：購買(有訂單) / 批次 / 匯入 / 手動；null 視為手動（歷史資料無法細分） */
export function enrollmentSource(
  source: string | null | undefined,
  orderId: string | null | undefined,
): { text: string; className: string } {
  if (orderId || source === "PURCHASE")
    return { text: "購買", className: "bg-green-50 text-green-700" };
  switch (source) {
    case "BATCH":
      return { text: "批次開通", className: "bg-amber-50 text-amber-700" };
    case "IMPORT":
      return { text: "匯入開通", className: "bg-purple-50 text-purple-700" };
    case "MANUAL":
    default:
      return { text: "手動開通", className: "bg-blue-50 text-blue-700" };
  }
}

export const ORDER_STATUS_LABEL: Record<string, string> = {
  PENDING: "待付款",
  PAID: "已付款",
  FAILED: "付款失敗",
  EXPIRED: "已逾期",
  REFUNDED: "已退款",
};

export const ORDER_STATUS_COLOR: Record<string, string> = {
  PENDING: "bg-amber-100 text-amber-700",
  PAID: "bg-green-100 text-green-700",
  FAILED: "bg-red-100 text-red-700",
  EXPIRED: "bg-gray-100 text-gray-600",
  REFUNDED: "bg-blue-100 text-blue-700",
};
