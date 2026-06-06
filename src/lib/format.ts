/** 把整數金額（新台幣元）格式化成 NT$1,234 */
export function formatNT(amount: number): string {
  return "NT$" + amount.toLocaleString("zh-TW");
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
