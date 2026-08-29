import { isOverseasPhone } from "@/lib/sms/phone";

// 課前通知進度（純函式，場次看板與簡訊／EDM 頁共用）。
// 開課前名單會重複匯入，所以口徑是「誰還沒通知到」而不是「這批是誰」：
// 漏發、發失敗、事後才補手機的人，下次都會自動被撈回未通知名單。

export type NoticeSignup = {
  phone: string | null;
  email: string | null;
  smsNoticeAt: Date | string | null;
  emailNoticeAt: Date | string | null;
  deferredToSessionId: string | null;
};

/** 簡訊發得到：有號碼且不是海外門號（不發國際簡訊，那些人只能走 Email） */
export const smsReachable = (s: { phone: string | null }) =>
  !!s.phone && !isOverseasPhone(s.phone);

export const emailReachable = (s: { email: string | null }) =>
  !!s.email && s.email.includes("@");

export type NoticeProgress = {
  smsPending: number; // 發得到簡訊、但還沒發的人
  smsDone: number;
  emailPending: number;
  emailDone: number;
  /** 兩個通道都聯絡不到（沒手機又沒信箱）——這些人再怎麼發都收不到，要人工補資料 */
  unreachable: number;
};

/** 已延期到別場的不算在本場進度內（新場次名單自然涵蓋他）。
 *  工作人員仍計入：他們也需要知道時間地點。 */
export function computeNoticeProgress(signups: NoticeSignup[]): NoticeProgress {
  const p: NoticeProgress = {
    smsPending: 0,
    smsDone: 0,
    emailPending: 0,
    emailDone: 0,
    unreachable: 0,
  };
  for (const s of signups) {
    if (s.deferredToSessionId) continue;
    const sms = smsReachable(s);
    const mail = emailReachable(s);
    if (!sms && !mail) {
      p.unreachable++;
      continue;
    }
    if (sms) (s.smsNoticeAt ? p.smsDone++ : p.smsPending++);
    if (mail) (s.emailNoticeAt ? p.emailDone++ : p.emailPending++);
  }
  return p;
}
