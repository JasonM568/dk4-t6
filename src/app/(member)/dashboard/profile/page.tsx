import Link from "next/link";
import { redirect } from "next/navigation";
import { getAuthUser } from "@/lib/supabase/server";
import { getProfile } from "@/lib/supabase/admin";
import { getMemberProfile } from "@/lib/member-profile";
import { PrivacyNotice } from "@/components/privacy-notice";
import { formatDate } from "@/lib/format";
import { PhoneForm } from "./phone-form";

export const metadata = { title: "會員資料 — 會員中心" };

export default async function MemberProfilePage({
  searchParams,
}: {
  searchParams: Promise<{ updated?: string }>;
}) {
  const user = await getAuthUser();
  if (!user) redirect("/login");

  const [profile, memberProfile, params] = await Promise.all([
    getProfile(user.id),
    getMemberProfile(user.id),
    searchParams,
  ]);
  // 沒有補填紀錄理論上進不來（(member)/layout 閘門），保險再導一次
  if (!memberProfile) redirect("/complete-profile?next=%2Fdashboard%2Fprofile");

  return (
    <div className="mx-auto max-w-2xl px-4 py-10">
      <Link href="/dashboard" className="text-sm text-gray-500 hover:text-black">
        ← 會員中心
      </Link>
      <h1 className="mb-6 mt-2 text-2xl font-bold">會員資料</h1>

      {params.updated && (
        <p className="mb-4 rounded-lg bg-green-50 px-3 py-2 text-sm text-green-700">
          手機號碼已更新
        </p>
      )}

      <section className="mb-6 space-y-3 rounded-xl border border-gray-200 p-4">
        <div>
          <div className="text-xs text-gray-400">姓名</div>
          <div className="text-sm">{profile?.display_name ?? "—"}</div>
        </div>
        <div>
          <div className="text-xs text-gray-400">Email</div>
          <div className="text-sm">{user.email}</div>
        </div>
        <p className="text-xs text-gray-400">
          姓名與 Email 為帳號基本資料，如需修改請聯繫客服。
        </p>
      </section>

      <section className="mb-6 rounded-xl border border-gray-200 p-4">
        <h2 className="mb-3 text-sm font-semibold">手機號碼</h2>
        <PhoneForm currentPhone={memberProfile.phone} />
      </section>

      <section className="rounded-xl border border-gray-200 p-4">
        <h2 className="mb-3 text-sm font-semibold">個人資料蒐集同意</h2>
        <p className="mb-3 rounded-lg bg-green-50 px-3 py-2 text-xs text-green-700">
          ✓ 你已於 {formatDate(memberProfile.privacyConsentAt)} 同意個人資料蒐集告知事項
          （版本 {memberProfile.privacyConsentVersion}）
        </p>
        <PrivacyNotice />
        <p className="mt-3 text-xs text-gray-400">
          如欲行使個資法上之權利（查詢、更正、刪除等），請依告知事項內的聯絡方式與我們聯繫。
        </p>
      </section>
    </div>
  );
}
