import { NextRequest } from "next/server";
import { getPaymentProvider } from "@/lib/payment";
import { PayuniProvider } from "@/lib/payment/payuni";

// 場次報名付款完成後，瀏覽器被 PAYUNi Form Post 導回此處。
// 只負責把使用者導到感謝頁；實際名單/狀態以 session-notify 為準。
export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const base = process.env.NEXT_PUBLIC_BASE_URL ?? new URL(req.url).origin;
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return Response.redirect(`${base}/event/thanks`, 303);
  }
  const payload: Record<string, string> = {};
  form.forEach((value, key) => {
    payload[key] = String(value);
  });

  let orderNo = "";
  const provider = getPaymentProvider();
  if (provider instanceof PayuniProvider) {
    const result = provider.verifyCallback(payload);
    if (result.valid) orderNo = result.orderNo;
  }
  const target = orderNo
    ? `${base}/event/thanks?order=${encodeURIComponent(orderNo)}`
    : `${base}/event/thanks`;
  return Response.redirect(target, 303);
}
