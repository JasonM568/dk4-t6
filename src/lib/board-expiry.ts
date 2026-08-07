// 看板自動下架的過期判斷：以「台北時間的日」為單位——
// 結束日當天整天照常顯示，隔天 00:00（台北時間）起算過期。
// 純函式，server（看板查詢/報名 action）與 client（後台已結束標籤）共用。

const TAIPEI_OFFSET_MS = 8 * 60 * 60 * 1000; // 台北固定 UTC+8，無日光節約

/** 取台北時間的日期字串（YYYY-MM-DD），供同日比較 */
function taipeiDayKey(d: Date): string {
  return new Date(d.getTime() + TAIPEI_OFFSET_MS).toISOString().slice(0, 10);
}

/** 結束日已過（台北時間已進入隔天）？null/undefined = 永不過期 */
export function hasEndedInTaipei(endDate: Date | string | null | undefined): boolean {
  if (!endDate) return false;
  const end = typeof endDate === "string" ? new Date(endDate) : endDate;
  if (Number.isNaN(end.getTime())) return false;
  return taipeiDayKey(new Date()) > taipeiDayKey(end);
}
