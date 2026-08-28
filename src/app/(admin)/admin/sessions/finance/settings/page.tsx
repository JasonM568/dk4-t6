import { pageGuardFullAdmin } from "@/lib/auth/staff";
import { getFinanceSettings } from "@/lib/finance/settings";
import { SettingsForm } from "./settings-form";

export const metadata = { title: "收支費率設定 — 管理後台" };
export const dynamic = "force-dynamic";

// 收支模組的全域費率與預設分潤。改動只影響「之後的計算」；
// 已結算（LOCKED）場次讀快照不受影響，DRAFT 場次下次開頁即用新費率。
export default async function FinanceSettingsPage() {
  await pageGuardFullAdmin();
  const settings = await getFinanceSettings();
  return (
    <div className="max-w-2xl">
      <h1 className="mb-1 text-2xl font-bold">收支費率設定</h1>
      <p className="mb-6 text-sm text-gray-500">
        稅費與手續費的自動計算費率、每場次的預設內部分潤。
        個別場次可在該場的收支頁覆寫，不受這裡影響。
      </p>
      <SettingsForm
        initial={{
          invoiceTaxPct: settings.invoiceTaxPpm / 10_000,
          incomeTaxPct: settings.incomeTaxPpm / 10_000,
          cardFeePct: settings.cardFeePpm / 10_000,
          cardInstallFeePct: settings.cardInstallFeePpm / 10_000,
          atmMode: settings.atmMode,
          atmUnitFee: settings.atmUnitFee,
          atmFeePct: settings.atmFeePpm / 10_000,
          remitUnitFee: settings.remitUnitFee,
          shares: settings.internalShares.map((s) => ({ name: s.name, pct: s.ppm / 10_000 })),
          externalSharePct: settings.externalSharePpm / 10_000,
          internalPromoters: settings.internalPromoters.join("、"),
        }}
      />
    </div>
  );
}
