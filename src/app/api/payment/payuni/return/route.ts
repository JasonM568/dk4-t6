import { NextRequest } from "next/server";
import { getPaymentProvider } from "@/lib/payment";
import { PayuniProvider } from "@/lib/payment/payuni";

// 使用者付款完成後，瀏覽器被 PAYUNi Form Post 導回此處（ReturnURL）。
// 僅用於把使用者導到訂單頁顯示結果，實際開通/狀態以 notify 為準。
// PAYUNi 的回傳整包加密，訂單號要驗章解密後才拿得到（與 ECPay 明文不同）。
export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  // 前景導回頁：body 解析失敗就導去我的課程，不能讓使用者看到 500
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    const base = process.env.NEXT_PUBLIC_BASE_URL ?? new URL(req.url).origin;
    return Response.redirect(`${base}/my-courses`, 303);
  }
  const payload: Record<string, string> = {};
  form.forEach((value, key) => {
    payload[key] = String(value);
  });

  const base = process.env.NEXT_PUBLIC_BASE_URL ?? new URL(req.url).origin;
  let orderNo = "";
  const provider = getPaymentProvider();
  if (provider instanceof PayuniProvider) {
    const result = provider.verifyCallback(payload);
    if (result.valid) orderNo = result.orderNo;
  }
  const target = orderNo ? `${base}/orders/${orderNo}` : `${base}/my-courses`;
  return Response.redirect(target, 303);
}
