import { redirect } from "next/navigation";

// 收支結算已獨立成 /admin/finance 類別（2026-08-29）；舊網址轉址保留書籤可用
export default function LegacyFinanceSettingsPage() {
  redirect("/admin/finance/settings");
}
