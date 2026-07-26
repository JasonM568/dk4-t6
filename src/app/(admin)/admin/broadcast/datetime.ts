/** Date → datetime-local 值（台北時間 YYYY-MM-DDTHH:mm）；sv-SE locale 天然輸出 ISO 樣式 */
export function toDatetimeLocal(d: Date | null): string {
  if (!d) return "";
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  })
    .format(d)
    .replace(" ", "T");
}
