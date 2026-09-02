import "server-only";

import { prisma } from "@/lib/db";
import { normalizeContactPhone } from "@/lib/sms/phone";
import { getAuthUserIdsByEmails } from "@/lib/supabase/admin";

// 講座索取名單「從會員資料補手機」。
//
// 為什麼不是「email 撈到就寫」——這是本檔存在的全部理由：
// 訂購人常拿自己的信箱幫別人報名，同一個信箱底下會有兩個人的號碼。
// 正式資料就有現成案例：tsung0906@gmail.com 底下同時有陳建中與蘇郁雅
// （schema 註解寫的那個「蘇郁雅報名時填的是先生陳建中的信箱」）。
// 只憑 email 取第一筆，提醒簡訊就會發到別人手機上。
//
// 所以規則是：**姓名對得起來才寫**，對不起來一律列出來讓人決定，絕不自動猜。
// 同 upsertStudent 的「姓名不同＝不同人」鐵則。

/** 姓名比對用的正規化：去掉所有空白與大小寫差異（「陳 建中」＝「陳建中」） */
function normName(n: string | null | undefined): string {
  return (n ?? "").replace(/\s+/g, "").toLowerCase();
}

export type PhoneCandidate = {
  phone: string;
  sourceName: string | null;
  source: string;
};

export type BackfillRow = {
  requestId: string;
  name: string | null;
  email: string;
  /** FILLED = 已寫入；REVIEW = 找到號碼但不敢寫，要人工確認；NOT_FOUND = 查無 */
  status: "FILLED" | "REVIEW" | "NOT_FOUND";
  phone?: string;
  /** REVIEW 的原因，直接顯示給操作者 */
  reason?: string;
  candidates: PhoneCandidate[];
};

export type BackfillReport = {
  rows: BackfillRow[];
  filled: number;
  review: number;
  notFound: number;
  /** 會員資料（MemberProfile）這次有沒有查成功；失敗只是少一個來源，不中斷 */
  memberLookupOk: boolean;
};

/** 補齊某場講座「沒有手機」的索取紀錄。
 *  apply=false 只試算不寫入（讓操作者先看過再按）。 */
export async function backfillWebinarPhones(
  webinarId: string,
  {
    apply,
    // email → auth userId 的查法可注入：測試一律傳假的，
    // 否則跑一次測試就會拿正式金鑰去掃 Supabase Auth 的全部使用者
    //（鐵則：測試不碰正式站；同 guest-checkout 注入假實作的做法）
    lookupAuthIds = getAuthUserIdsByEmails,
  }: {
    apply: boolean;
    lookupAuthIds?: (emails: string[]) => Promise<Map<string, string>>;
  },
): Promise<BackfillReport> {
  const targets = await prisma.webinarRequest.findMany({
    where: { webinarId, phone: null },
    select: { id: true, name: true, email: true },
    orderBy: { createdAt: "asc" },
  });
  if (targets.length === 0)
    return { rows: [], filled: 0, review: 0, notFound: 0, memberLookupOk: true };

  const emails = [...new Set(targets.map((t) => t.email.toLowerCase()))];

  // 三個 course schema 的來源一次撈齊（email 一律小寫比對）
  const [students, signups, signupRequests] = await Promise.all([
    prisma.studentRecord.findMany({
      where: { email: { in: emails }, phone: { not: null } },
      select: { email: true, phone: true, name: true },
    }),
    prisma.sessionSignup.findMany({
      where: { email: { in: emails }, phone: { not: null } },
      select: { email: true, phone: true, name: true },
    }),
    prisma.sessionSignupRequest.findMany({
      where: { email: { in: emails }, phone: { not: null } },
      select: { email: true, phone: true, name: true },
    }),
  ]);

  // MemberProfile 的鍵是 auth.users.id，得先把 email → userId 對起來。
  // Prisma 只管 course schema（專案鐵則），所以走 Supabase Admin API。
  // 失敗不中斷：少一個來源而已，其餘三個照樣比對。
  const memberCandidates: { email: string; phone: string; name: string | null }[] = [];
  let memberLookupOk = true;
  try {
    const idByEmail = await lookupAuthIds(emails);
    if (idByEmail.size > 0) {
      const profiles = await prisma.memberProfile.findMany({
        where: { userId: { in: [...idByEmail.values()] } },
        select: { userId: true, phone: true, name: true },
      });
      const emailById = new Map([...idByEmail].map(([e, id]) => [id, e]));
      for (const p of profiles) {
        const e = emailById.get(p.userId);
        if (e) memberCandidates.push({ email: e, phone: p.phone, name: p.name });
      }
    }
  } catch (e) {
    memberLookupOk = false;
    console.error("[webinar-backfill] 會員資料查詢失敗，改用其餘來源", e);
  }

  // 依可信度排序：會員本人補填 > 上課記錄卡 > 訂單匯入 > 報名頁待確認
  const pool: { email: string; phone: string; name: string | null; source: string }[] = [
    ...memberCandidates.map((r) => ({ ...r, source: "會員補填" })),
    ...students.map((r) => ({ email: r.email!, phone: r.phone!, name: r.name, source: "上課記錄卡" })),
    ...signups.map((r) => ({ email: r.email!, phone: r.phone!, name: r.name, source: "訂單匯入" })),
    ...signupRequests.map((r) => ({ email: r.email!, phone: r.phone!, name: r.name, source: "報名頁" })),
  ];

  const byEmail = new Map<string, PhoneCandidate[]>();
  for (const r of pool) {
    const phone = normalizeContactPhone(r.phone);
    if (!phone) continue; // 市話、格式錯的一律不採用
    const key = r.email.toLowerCase();
    byEmail.set(key, [
      ...(byEmail.get(key) ?? []),
      { phone, sourceName: r.name, source: r.source },
    ]);
  }

  // 同一場已經用到的號碼：補進來會撞號（多半是代填），列為需確認
  const usedPhones = new Set(
    (
      await prisma.webinarRequest.findMany({
        where: { webinarId, phone: { not: null } },
        select: { phone: true },
      })
    ).map((r) => r.phone!),
  );

  const rows: BackfillRow[] = [];
  for (const t of targets) {
    const candidates = byEmail.get(t.email.toLowerCase()) ?? [];
    if (candidates.length === 0) {
      rows.push({ requestId: t.id, name: t.name, email: t.email, status: "NOT_FOUND", candidates: [] });
      continue;
    }
    const matched = candidates.filter((c) => normName(c.sourceName) === normName(t.name));
    const distinct = [...new Set(matched.map((c) => c.phone))];

    if (matched.length === 0) {
      rows.push({
        requestId: t.id, name: t.name, email: t.email, status: "REVIEW", candidates,
        reason: "查到號碼，但登記姓名與資料庫裡的姓名不同——可能是別人用這個信箱代填",
      });
    } else if (distinct.length > 1) {
      rows.push({
        requestId: t.id, name: t.name, email: t.email, status: "REVIEW", candidates: matched,
        reason: "同一個姓名查到多支不同號碼，無法判斷哪一支才是現用的",
      });
    } else if (usedPhones.has(distinct[0])) {
      rows.push({
        requestId: t.id, name: t.name, email: t.email, status: "REVIEW", candidates: matched,
        reason: "這支號碼在本場名單已經有人用了（同一支號碼只會收到一則）",
      });
    } else {
      rows.push({
        requestId: t.id, name: t.name, email: t.email, status: "FILLED",
        phone: distinct[0], candidates: matched,
      });
      usedPhones.add(distinct[0]); // 同一批裡不重複配同一支號碼
    }
  }

  if (apply) {
    for (const r of rows.filter((x) => x.status === "FILLED")) {
      // 條件帶 phone: null：兩人同時按時，後按的不會覆蓋先寫進去的值
      await prisma.webinarRequest.updateMany({
        where: { id: r.requestId, phone: null },
        data: { phone: r.phone },
      });
    }
  }

  return {
    rows,
    filled: rows.filter((r) => r.status === "FILLED").length,
    review: rows.filter((r) => r.status === "REVIEW").length,
    notFound: rows.filter((r) => r.status === "NOT_FOUND").length,
    memberLookupOk,
  };
}
