import { redirect } from "next/navigation";
import { getAuthUser } from "@/lib/supabase/server";
import { getMemberProfile } from "@/lib/member-profile";
import { getProfile } from "@/lib/supabase/admin";
import { CompleteProfileForm } from "./form";

export const metadata = { title: "補齊會員資料" };

export default async function CompleteProfilePage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const user = await getAuthUser();
  if (!user) redirect("/login");

  const [profile, qbcProfile, params] = await Promise.all([
    getMemberProfile(user.id),
    getProfile(user.id).catch(() => null),
    searchParams,
  ]);
  // 已完整補齊（同意＋姓名）就不用再填。
  // 舊會員可能已同意但沒填過姓名（姓名欄位後加的）——結帳閘門會把他們導來這裡
  if (profile?.privacyConsentAt && profile.name) {
    redirect(/^\/(?!\/)/.test(params.next ?? "") ? params.next! : "/dashboard");
  }

  return (
    <CompleteProfileForm
      next={params.next ?? ""}
      // 訂單回填的手機預填進表單：會員確認號碼、勾同意即完成
      defaultPhone={profile?.phone ?? ""}
      // 姓名預填：自管姓名 → QBC 顯示名稱，確認即可不用重打
      defaultName={profile?.name ?? qbcProfile?.display_name ?? ""}
    />
  );
}
