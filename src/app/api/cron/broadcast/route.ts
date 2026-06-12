import { NextResponse } from "next/server";
import { processDueBroadcasts } from "@/lib/email/dispatch";

// Vercel Cron（vercel.json：*/5 * * * *）。
// 設了 CRON_SECRET 環境變數後，Vercel 觸發時會自動帶 Authorization: Bearer <CRON_SECRET>。
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  const results = await processDueBroadcasts();
  return NextResponse.json({ processed: results.length, results });
}
