import { pageGuardFullAdmin } from "@/lib/auth/staff";
import { getPaymentToolConfig } from "@/lib/payment/pay-config";
import { PayConfigForm } from "./pay-config-form";

export const metadata = { title: "付款設定" };
export const dynamic = "force-dynamic";

export default async function PaymentSettingsPage() {
  await pageGuardFullAdmin();
  const config = await getPaymentToolConfig();

  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="mb-2 text-2xl font-bold">付款設定</h1>
      <p className="mb-6 text-sm text-gray-500">
        控制 PAYUNi 付款頁顯示哪些付款方式。存檔後**下一筆**新訂單生效；
        已建立的待付款訂單維持建單當下的選項。
      </p>
      <PayConfigForm initial={config} />
    </div>
  );
}
