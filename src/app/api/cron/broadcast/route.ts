import { NextResponse } from "next/server";
import { processDueBroadcasts } from "@/lib/email/dispatch";
import { processDueSmsBroadcasts } from "@/lib/sms/dispatch";

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

  return NextResponse.json({
    email: { processed: email.length, results: email },
    sms: { processed: sms.length, results: sms },
  });
}
