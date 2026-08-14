import crypto from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { mapMaacGoStatus, describeDeliveryError } from "@/lib/sms/provider/maacgo";
import { syncBroadcastCounts } from "@/lib/sms/dispatch";

// MAAC Go webhook：sms.sent / sms.delivered / sms.failed → SmsMessage 逐筆狀態。
// 驗簽：X-Cresclab-Signature = HMAC_SHA256(MAACGO_WEBHOOK_SECRET, 原始 body) 的 hex。
//
// 沒設定 secret 時一律 503（不是靜默接受）——收到未驗簽的請求就寫資料庫，
// 等於開放任何人竄改發送紀錄。未設定期間狀態改由 cron 輪詢更新，功能不會空轉。

function verify(secret: string, rawBody: string, header: string | null): boolean {
  if (!header) return false;
  const expected = crypto.createHmac("sha256", secret).update(rawBody).digest();
  // 容忍 "sha256=" 前綴與大小寫差異
  const given = Buffer.from(header.trim().replace(/^sha256=/i, ""), "hex");
  return (
    given.length === expected.length && crypto.timingSafeEqual(given, expected)
  );
}

export async function POST(request: NextRequest) {
  const secret = process.env.MAACGO_WEBHOOK_SECRET;
  if (!secret) {
    console.error("[sms/webhook] MAACGO_WEBHOOK_SECRET 未設定，拒絕處理");
    return new NextResponse("Webhook secret not configured", { status: 503 });
  }

  const raw = await request.text();
  if (!verify(secret, raw, request.headers.get("x-cresclab-signature"))) {
    return new NextResponse("Invalid signature", { status: 401 });
  }

  let payload: { event?: string; data?: { id?: string; status?: string; error?: string | null } };
  try {
    payload = JSON.parse(raw);
  } catch {
    return new NextResponse("Invalid JSON", { status: 400 });
  }

  const messageId = payload.data?.id;
  if (!messageId) return NextResponse.json({ ok: true, skipped: "no id" });

  // 事件名稱優先（sms.delivered/failed 已是結論），沒有才看 data.status
  const status =
    payload.event === "sms.delivered"
      ? "DELIVERED"
      : payload.event === "sms.failed"
        ? "FAILED"
        : mapMaacGoStatus(payload.data?.status ?? payload.event?.replace("sms.", ""));

  const existing = await prisma.smsMessage.findUnique({
    where: { providerMessageId: messageId },
    select: { id: true, broadcastId: true, mobile: true, status: true },
  });
  if (!existing) return NextResponse.json({ ok: true, skipped: "unknown message" });

  // 已是最終狀態就不再回退（webhook 可能亂序送達：delivered 之後才收到 sent）
  if (["DELIVERED", "FAILED", "STOP"].includes(existing.status) && status === "SENT") {
    return NextResponse.json({ ok: true, skipped: "stale event" });
  }

  await prisma.smsMessage.update({
    where: { id: existing.id },
    data: {
      status,
      error: describeDeliveryError(payload.data?.error ?? null),
      deliveredAt: status === "DELIVERED" ? new Date() : undefined,
      checkedAt: new Date(),
    },
  });
  if (status === "STOP") {
    await prisma.smsOptOut.upsert({
      where: { mobile: existing.mobile },
      create: { mobile: existing.mobile, source: "USER", reason: "簡訊回覆拒收" },
      update: {},
    });
  }
  await syncBroadcastCounts(existing.broadcastId);
  return NextResponse.json({ ok: true });
}
