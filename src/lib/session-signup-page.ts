// 場次公開報名頁的純函式（無 server-only、無 DB）：開放判定、名額、網址代稱。
// 放 src/lib/ 而非 actions/ 是因為 "use server" 檔案只能匯出 async 函式，
// 常數與同步函式一旦放進去，整個路由群組一載入就整頁失敗（見 CLAUDE.md）。

export const SIGNUP_SLUG_RE = /^[a-z0-9-]+$/;

/** 報名申請的訂單編號前綴。
 *  刻意與 1shop 訂單號、手動新增的「手動-」、收支的 ONSITE-/MANUAL- 都不同：
 *  1shop 退款會 deleteMany by orderNo 全域刪除名單列，前綴撞號等於被誤刪。 */
export const WEB_ORDER_PREFIX = "WEB-";

export const MEALS = ["MEAT", "VEG"] as const;
export type SignupMeal = (typeof MEALS)[number];

export const SIGNUP_REQUEST_STATUS = {
  PENDING: "PENDING",
  CONFIRMED: "CONFIRMED",
  CANCELLED: "CANCELLED",
} as const;

/** 一次報名最多幾位參加者（訂購人＋同行者）。
 *  上限存在的理由是防灌單，不是業務限制；要帶更多人請走後台手動新增。 */
export const MAX_ATTENDEES = 6;

export type SignupWindow = {
  session: {
    isSignupOpen: boolean;
    signupOpenAt: Date | null;
    signupCloseAt: Date | null;
    eventDate: Date | null;
    endDate: Date | null;
    signupQuota: number | null;
  };
  /** 已佔用名額 = 已確認名單（未延出）＋ 待確認申請 */
  taken: number;
  now: Date;
};

export type SignupClosedReason =
  | "CLOSED" // 總開關關閉
  | "NOT_YET" // 還沒開始
  | "ENDED" // 已截止或課程已結束
  | "FULL"; // 額滿

/** 報名是否開放；不開放時回傳原因，讓前台顯示不同文案。
 *  額滿與截止分開判斷——「額滿」要引導候補，「已截止」不要。 */
export function signupState(
  w: SignupWindow,
): { open: true } | { open: false; reason: SignupClosedReason } {
  const { session: s, now } = w;
  if (!s.isSignupOpen) return { open: false, reason: "CLOSED" };
  if (s.signupOpenAt && now < s.signupOpenAt) return { open: false, reason: "NOT_YET" };
  if (s.signupCloseAt && now > s.signupCloseAt) return { open: false, reason: "ENDED" };
  // 沒設截止就以開課日兜底：課都上完了還開著報名是最容易漏掉的失誤
  const lastDay = s.endDate ?? s.eventDate;
  if (!s.signupCloseAt && lastDay && now > endOfTaipeiDay(lastDay)) {
    return { open: false, reason: "ENDED" };
  }
  if (s.signupQuota !== null && w.taken >= s.signupQuota) {
    return { open: false, reason: "FULL" };
  }
  return { open: true };
}

export const CLOSED_MESSAGE: Record<SignupClosedReason, string> = {
  CLOSED: "此場次目前未開放報名",
  NOT_YET: "報名尚未開始，請稍後再回來",
  ENDED: "報名已截止",
  FULL: "本場次名額已滿",
};

/** 剩餘名額；不限額回 null。用於「剩 N 位」提示，負數夾到 0。 */
export function remainingSeats(quota: number | null, taken: number): number | null {
  if (quota === null) return null;
  return Math.max(0, quota - taken);
}

/** 台北時間當日 23:59:59.999（DB 存 UTC，開課日只有日期沒有時間）。
 *  同 board-expiry 的口徑：當天照常開放，隔天才關。 */
function endOfTaipeiDay(d: Date): Date {
  const taipeiMidnight = new Date(d);
  taipeiMidnight.setUTCHours(0, 0, 0, 0);
  // +1 天 −8 小時 = 台北當日結束的 UTC 時刻
  return new Date(taipeiMidnight.getTime() + 24 * 60 * 60 * 1000 - 8 * 60 * 60 * 1000);
}

/** 產生報名訂單編號：WEB- + 10 位英數（時間序無關，不可被枚舉猜號）。 */
export function makeWebOrderNo(random: () => number = Math.random): string {
  const alphabet = "0123456789ABCDEFGHJKLMNPQRSTUVWXYZ"; // 去掉易混的 I/O
  let s = "";
  for (let i = 0; i < 10; i++) s += alphabet[Math.floor(random() * alphabet.length)];
  return WEB_ORDER_PREFIX + s;
}

/** 參加者序號 → attendeeKey。第一位是訂購人本人。 */
export function attendeeKeyAt(index: number): string {
  return index === 0 ? "buyer" : `companion-${index}`;
}

/** Google 地圖連結（地址可能含樓層、括號，一律 encode）。 */
export function mapUrl(address: string): string {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`;
}
