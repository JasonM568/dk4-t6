// 報名參加者解析（純函式，無 server-only）——公開報名頁的「送出報名」（待確認流程）
// 與「平台金流結帳」共用同一套同行者鐵則：每位參加者必填本人手機，訂購人不得代填
// 自己的號碼（否則學員記錄卡會把兩個人併成一張）。兩條路徑各寫一份遲早會走鐘。

import { explainMobile, MOBILE_REJECT_LABEL } from "@/lib/sms/phone";
import { isSamePerson } from "@/lib/session-roster";
import { MAX_ATTENDEES } from "@/lib/session-signup-page";

export type ParsedAttendee = {
  name: string;
  phone: string;
  email: string | null;
  meal: "MEAT" | "VEG";
  isRetrain: boolean;
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** 解析第 i 位參加者；整列留空回 null（略過），有問題回 { error }。 */
export function parseAttendee(
  formData: FormData,
  i: number,
): ParsedAttendee | { error: string } | null {
  const name = String(formData.get(`attendee-${i}-name`) ?? "").trim();
  const phoneRaw = String(formData.get(`attendee-${i}-phone`) ?? "").trim();
  const email = String(formData.get(`attendee-${i}-email`) ?? "").trim().toLowerCase();
  const mealRaw = String(formData.get(`attendee-${i}-meal`) ?? "");
  const isRetrain = formData.get(`attendee-${i}-retrain`) === "on";

  if (!name && !phoneRaw && !email) return null;
  const who = name || `第 ${i + 1} 位參加者`;
  if (!name) return { error: `請填寫第 ${i + 1} 位參加者的姓名` };

  if (!phoneRaw) return { error: `請填寫「${who}」本人的手機（每位參加者要留自己的號碼）` };
  const { mobile, reject, overseas } = explainMobile(phoneRaw);
  if (!mobile && !overseas) {
    return {
      error: `「${who}」的手機${reject ? `：${MOBILE_REJECT_LABEL[reject]}` : "格式不正確"}（請填 09 開頭 10 碼，海外門號請加國碼如 +60123456789）`,
    };
  }
  if (email && !EMAIL_RE.test(email)) return { error: `「${who}」的 Email 格式不正確` };

  return {
    name,
    phone: mobile ?? overseas!,
    email: email || null,
    meal: mealRaw === "VEG" ? "VEG" : "MEAT",
    isRetrain,
  };
}

/** 蒐集整張表單的參加者並做同張訂單內自撞名檢查。回傳 { attendees } 或 { error }。 */
export function collectAttendees(
  formData: FormData,
): { attendees: ParsedAttendee[] } | { error: string } {
  const attendees: ParsedAttendee[] = [];
  for (let i = 0; i < MAX_ATTENDEES; i++) {
    const parsed = parseAttendee(formData, i);
    if (parsed === null) continue;
    if ("error" in parsed) return { error: parsed.error };
    attendees.push(parsed);
  }
  if (attendees.length === 0) return { error: "請至少填寫一位參加者" };

  for (let i = 1; i < attendees.length; i++) {
    if (attendees.slice(0, i).some((a) => isSamePerson(a, attendees[i]))) {
      return { error: `「${attendees[i].name}」在這次報名中重複填寫了` };
    }
  }
  return { attendees };
}
