import { NextResponse } from "next/server";
import { processDueBroadcasts } from "@/lib/email/dispatch";
import { processDueSmsBroadcasts, refreshSmsDelivery } from "@/lib/sms/dispatch";
import { purgeOldRegisterAttempts } from "@/lib/auth/register-log";

// 大量群發（數百封分批＋退避重試）可能超過平台預設時限，明確給足 300s
export const maxDuration = 300;

// Vercel Cron（vercel.json：*/5 * * * *）。
// 設了 CRON_SECRET 環境變數後，Vercel 觸發時會自動帶 Authorization: Bearer <CRON_SECRET>。
//
// Email 與簡訊共用這一個 5 分鐘 tick：兩者的排程機制完全相同（原子認領＋逾時回收），
// 共用可以少一個會動的零件，也不必為簡訊另外開一條 vercel.json cron。
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  // 依序執行：簡訊失敗不該影響 email 的排程處理，反之亦然
  const email = await processDueBroadcasts();
  let sms: Awaited<ReturnType<typeof processDueSmsBroadcasts>> = [];
  try {
    sms = await processDueSmsBroadcasts();
  } catch (e) {
    console.error("[sms cron] 處理排程簡訊時發生例外：", e);
  }

  // 送達狀態回補：webhook 沒設定（或漏收）時，靠這條每 5 分鐘補齊
  let delivery = { checked: 0, updated: 0 };
  try {
    delivery = await refreshSmsDelivery();
  } catch (e) {
    console.error("[sms cron] 更新送達狀態時發生例外：", e);
  }

  // 註冊嘗試紀錄的保存期限清理：每日一次就夠，借這條 5 分鐘 tick 跑，
  // 不另外開一條 vercel.json cron（同 email/簡訊共用這個 tick 的理由）。
  // 只在台北時間 03:00–03:05 這個窗口動作 → 一天剛好命中一次。
  let purged = 0;
  const tpeHour = Number(
    new Intl.DateTimeFormat("en-US", {
      timeZone: "Asia/Taipei",
      hour: "2-digit",
      hour12: false,
    }).format(new Date()),
  );
  const tpeMinute = new Date(Date.now() + 8 * 60 * 60 * 1000).getUTCMinutes();
  if (tpeHour === 3 && tpeMinute < 5) {
    try {
      purged = await purgeOldRegisterAttempts();
    } catch (e) {
      console.error("[cron] 清理註冊嘗試紀錄時發生例外：", e);
    }
  }

  return NextResponse.json({
    email: { processed: email.length, results: email },
    sms: { processed: sms.length, results: sms },
    smsDelivery: delivery,
    registerAttemptsPurged: purged,
  });
}
