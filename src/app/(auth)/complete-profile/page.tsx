import { redirect } from "next/navigation";
import { getAuthUser } from "@/lib/supabase/server";
import { getMemberProfile } from "@/lib/member-profile";
import { CompleteProfileForm } from "./form";

export const metadata = { title: "補齊會員資料" };

export default async function CompleteProfilePage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const user = await getAuthUser();
  if (!user) redirect("/login");

  const [profile, params] = await Promise.all([
    getMemberProfile(user.id),
    searchParams,
  ]);
  // 已完整補齊（有手機＋同意）就不用再填
  if (profile?.privacyConsentAt) redirect("/dashboard");

  return (
    <CompleteProfileForm
      next={params.next ?? ""}
      // 訂單回填的手機預填進表單：會員確認號碼、勾同意即完成
      defaultPhone={profile?.phone ?? ""}
    />
  );
}
