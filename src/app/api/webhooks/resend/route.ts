import crypto from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/db";

// Resend Webhook（svix 格式）：email.delivered/opened/clicked/bounced/complained
// → BroadcastEvent 事件回流（唯一鍵天然去重）；退信/投訴自動加入退訂名單。
// 需要環境變數 RESEND_WEBHOOK_SECRET（Resend Dashboard 建 webhook 後複製，whsec_ 開頭）。
// 手動驗簽不裝 svix 依賴：HMAC-SHA256(base64 解碼的 secret, `${id}.${timestamp}.${rawBody}`) base64。

const TIMESTAMP_TOLERANCE_SEC = 300; // ±5 分鐘防重放

const EVENT_TYPE_MAP: Record<string, string> = {
  "email.delivered": "DELIVERED",
  "email.opened": "OPENED",
  "email.clicked": "CLICKED",
  "email.bounced": "BOUNCED",
  "email.complained": "COMPLAINED",
};

function verifySvixSignature(
  secret: string,
  id: string,
  timestamp: string,
  payload: string,
  signatureHeader: string,
): boolean {
  const key = Buffer.from(secret.replace(/^whsec_/, ""), "base64");
  const expected = crypto
    .createHmac("sha256", key)
    .update(`${id}.${timestamp}.${payload}`)
    .digest();
  // svix-signature 可能含多組空白分隔的 "v1,<base64>"，任一組通過即有效
  for (const part of signatureHeader.split(" ")) {
    const [version, sig] = part.split(",", 2);
    if (version !== "v1" || !sig) continue;
    try {
      const given = Buffer.from(sig, "base64");
      if (given.length === expected.length && crypto.timingSafeEqual(given, expected)) {
        return true;
      }
    } catch {
      // 非法 base64：試下一組
    }
  }
  return false;
}

/** tags 兩種 shape 都要吃：寄送時是 [{name,value}]，webhook 回來多為物件 map */
function extractTag(tags: unknown, name: string): string | null {
  if (Array.isArray(tags)) {
    const hit = (tags as { name?: string; value?: string }[]).find(
      (t) => t?.name === name,
    );
    return hit?.value ?? null;
  }
  if (tags && typeof tags === "object") {
    const v = (tags as Record<string, unknown>)[name];
    return typeof v === "string" ? v : null;
  }
  return null;
}

// 講座索取寄送狀態：依嚴重度只升不降（晚到的 DELIVERED 不能蓋掉 BOUNCED；
// OPENED/CLICKED 比 DELIVERED 資訊多所以較高；退信/投訴為終態）
const DELIVERY_RANK: Record<string, number> = {
  SENT: 0,
  FAILED: 0,
  DELIVERED: 1,
  OPENED: 2,
  CLICKED: 3,
  BOUNCED: 9,
  COMPLAINED: 9,
};

export async function POST(request: NextRequest) {
  const secret = process.env.RESEND_WEBHOOK_SECRET;
  if (!secret) return new NextResponse("Webhook not configured", { status: 503 });

  // 驗簽必須用 raw body 原文，驗完才 parse
  const payload = await request.text();
  const svixId = request.headers.get("svix-id");
  const svixTimestamp = request.headers.get("svix-timestamp");
  const svixSignature = request.headers.get("svix-signature");
  if (!svixId || !svixTimestamp || !svixSignature) {
    return new NextResponse("Missing signature headers", { status: 401 });
  }
  if (
    Math.abs(Date.now() / 1000 - Number(svixTimestamp)) > TIMESTAMP_TOLERANCE_SEC
  ) {
    return new NextResponse("Timestamp out of tolerance", { status: 401 });
  }
  if (!verifySvixSignature(secret, svixId, svixTimestamp, payload, svixSignature)) {
    return new NextResponse("Invalid signature", { status: 401 });
  }

  let event: {
    type?: string;
    data?: { to?: unknown; tags?: unknown; bounce?: { message?: string } };
  };
  try {
    event = JSON.parse(payload);
  } catch {
    return new NextResponse("Invalid JSON", { status: 400 });
  }

  const type = EVENT_TYPE_MAP[event.type ?? ""];
  if (!type) return NextResponse.json({ ignored: true }); // 未追蹤的事件型別

  const to = event.data?.to;
  const email =
    Array.isArray(to) && typeof to[0] === "string"
      ? to[0].trim().toLowerCase()
      : null;
  if (!email) return NextResponse.json({ ignored: true });

  const broadcastId = extractTag(event.data?.tags, "broadcast_id");

  // 無 broadcast_id（Auth 信等非群發信）不記事件；但退信/投訴仍要進退訂名單
  if (broadcastId) {
    await prisma.broadcastEvent.createMany({
      data: [{ broadcastId, email, type }],
      skipDuplicates: true, // 唯一鍵 (broadcastId,email,type) → webhook 重送冪等
    });
  }

  // 講座信事件回流：更新該筆索取的寄送狀態（只升不降；紀錄已被刪就靜默略過）
  const webinarId = extractTag(event.data?.tags, "webinar_id");
  if (webinarId) {
    const req = await prisma.webinarRequest.findUnique({
      where: { webinarId_email: { webinarId, email } },
      select: { id: true, deliveryStatus: true },
    });
    const currentRank = DELIVERY_RANK[req?.deliveryStatus ?? ""] ?? -1;
    if (req && DELIVERY_RANK[type] >= currentRank) {
      await prisma.webinarRequest.update({
        where: { id: req.id },
        data: {
          deliveryStatus: type,
          deliveryDetail:
            type === "BOUNCED"
              ? (event.data?.bounce?.message ?? "退信").slice(0, 500)
              : type === "COMPLAINED"
                ? "收件人檢舉為垃圾信"
                : null,
          deliveryAt: new Date(),
        },
      });
    }
  }

  if (type === "BOUNCED" || type === "COMPLAINED") {
    await prisma.mailUnsubscribe.upsert({
      where: { email },
      create: {
        email,
        source: type === "BOUNCED" ? "BOUNCE" : "COMPLAINT",
        reason:
          type === "BOUNCED"
            ? (event.data?.bounce?.message ?? "退信").slice(0, 500)
            : "收件人檢舉為垃圾信",
      },
      update: {}, // 已在名單就不動（保留最早的 source/原因）
    });
  }

  return NextResponse.json({ ok: true });
}
