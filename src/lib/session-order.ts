/** 場次手動排序的純運算（不碰 DB、不碰 React）。
 *
 *  抽出來是因為「把第 5 場拖到第 2 場」這種索引運算很容易差一格，
 *  而錯了就是 Jason 的場次順序被打亂——但畫面上看起來一切正常。
 *  splice 的插入索引在「往下移」時會因為前面先被抽掉而位移一格，
 *  這正是最容易寫錯的地方，所以兩個方向都要有測試。 */

/** 把 id 往上（delta=-1）或往下（delta=+1）移一格。
 *  已在頂/底或找不到 id 時原樣回傳（同一個陣列參考，呼叫端可據此略過寫入）。 */
export function moveByDelta<T extends { id: string }>(
  list: T[],
  id: string,
  delta: number,
): T[] {
  const from = list.findIndex((x) => x.id === id);
  if (from < 0) return list;
  const to = from + delta;
  if (to < 0 || to >= list.length) return list;
  const next = [...list];
  const [row] = next.splice(from, 1);
  next.splice(to, 0, row);
  return next;
}

/** 拖曳：把 dragId 移到 targetId 目前的位置。
 *  往下拖時 dragId 會落在 target 的後面（符合「放開時看到的插入線」的直覺）。 */
export function moveToTarget<T extends { id: string }>(
  list: T[],
  dragId: string,
  targetId: string,
): T[] {
  if (dragId === targetId) return list;
  const from = list.findIndex((x) => x.id === dragId);
  const to = list.findIndex((x) => x.id === targetId);
  if (from < 0 || to < 0) return list;
  const next = [...list];
  const [row] = next.splice(from, 1);
  next.splice(to, 0, row);
  return next;
}
