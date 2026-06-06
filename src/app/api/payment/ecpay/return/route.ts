import { NextRequest } from "next/server";

// 使用者付款完成後，瀏覽器被 ECPay POST 導回此處（OrderResultURL）。
// 僅用於把使用者導到訂單頁顯示結果，實際發貨/狀態以 notify 為準。
export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const form = await req.formData();
  const orderNo = String(form.get("MerchantTradeNo") ?? "");
  const base = process.env.NEXT_PUBLIC_BASE_URL ?? new URL(req.url).origin;
  const target = orderNo ? `${base}/orders/${orderNo}` : `${base}/my-courses`;
  return Response.redirect(target, 303);
}
