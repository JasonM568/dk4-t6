import { getAuthUser } from "@/lib/supabase/server";
import { requireCompleteProfile } from "@/lib/member-profile";

// 會員區閘門（dashboard / my-courses / learn / orders）：
// 2026-08-15 起手機必填——沒補過手機＋個資同意的既有會員一律先導去 /complete-profile。
// 未登入不在這裡擋（各頁本來就有自己的 redirect("/login")，職責不重複）。
export default async function MemberLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await getAuthUser();
  if (user) await requireCompleteProfile(user.id);
  return <>{children}</>;
}
