import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import {
  verifyUnsubscribeToken,
  normalizeEmail,
} from "@/lib/email/unsubscribe";

// RFC 8058 one-click 退訂：信箱服務商（Gmail 等）對 List-Unsubscribe header 的
// URI 直接 POST，不經人手 → 驗 token 後直接退訂，冪等。
export async function POST(request: NextRequest) {
  const email = request.nextUrl.searchParams.get("email") ?? "";
  const token = request.nextUrl.searchParams.get("token") ?? "";

  if (!verifyUnsubscribeToken(email, token)) {
    return new NextResponse("Invalid token", { status: 400 });
  }

  const normalized = normalizeEmail(email);
  await prisma.mailUnsubscribe.upsert({
    where: { email: normalized },
    create: { email: normalized, reason: "one-click" },
    update: {},
  });
  return new NextResponse("Unsubscribed", { status: 200 });
}
