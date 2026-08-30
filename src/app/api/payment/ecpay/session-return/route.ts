import { NextRequest } from "next/server";

// 場次報名付款完成後，瀏覽器被 ECPay POST 導回此處（sandbox 測試用）。
// 只導到感謝頁；實際名單/狀態以 session-notify 為準。
export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const form = await req.formData();
  const orderNo = String(form.get("MerchantTradeNo") ?? "");
  const base = process.env.NEXT_PUBLIC_BASE_URL ?? new URL(req.url).origin;
  const target = orderNo
    ? `${base}/event/thanks?order=${encodeURIComponent(orderNo)}`
    : `${base}/event/thanks`;
  return Response.redirect(target, 303);
}
