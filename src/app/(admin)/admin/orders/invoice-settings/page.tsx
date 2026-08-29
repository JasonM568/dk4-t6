import { pageGuardFullAdmin } from "@/lib/auth/staff";
import { getInvoicePolicy } from "@/lib/invoice/policy";
import { InvoicePolicyForm } from "./policy-form";

export const metadata = { title: "發票設定" };
export const dynamic = "force-dynamic";

export default async function InvoiceSettingsPage() {
  await pageGuardFullAdmin();
  const policy = await getInvoicePolicy();

  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="mb-2 text-2xl font-bold">發票設定</h1>
      <p className="mb-6 text-sm text-gray-500">
        決定電子發票（ezPay）的開立時機。無論哪種模式，訂單詳情頁都可手動開立；
        重複開立有防呆，同一張訂單不會開出兩張發票。
      </p>
      <InvoicePolicyForm initial={policy} />
    </div>
  );
}
