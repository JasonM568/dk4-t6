"use server";

import { revalidatePath } from "next/cache";
import { getAuthUser } from "@/lib/supabase/server";
import { validateInviteCode, redeemInvite } from "@/lib/zone-invite";

export type RedeemState = { error?: string; success?: string } | null;

/**
 * 已登入會員在專區擋牆頁輸入邀請碼取得會籍。
 * email 一律取自登入者本人（不能替別人代領）。
 */
export async function redeemInviteAction(
  zoneSlug: string,
  _prev: RedeemState,
  formData: FormData,
): Promise<RedeemState> {
  const user = await getAuthUser();
  if (!user?.email) return { error: "請先登入再輸入邀請碼" };

  const result = await validateInviteCode(String(formData.get("code") ?? ""));
  if (!result.ok) return { error: result.error };

  await redeemInvite(result.invite, user.email, {
    name: user.displayName ?? null,
    userId: user.id,
  });

  revalidatePath(`/zone/${zoneSlug}`);
  return { success: `已加入「${result.invite.groupName}」` };
}
