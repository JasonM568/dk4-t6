import { isProfileComplete } from "@/lib/member-profile";
import { ProfileReminderClient } from "./profile-reminder-client";

/** 補填只作提醒；資料不完整仍可瀏覽已開通內容。 */
export async function ProfileReminder({
  userId,
  nextPath,
}: {
  userId: string;
  nextPath: string;
}) {
  if (await isProfileComplete(userId)) return null;
  return <ProfileReminderClient href={`/complete-profile?next=${encodeURIComponent(nextPath)}`} />;
}
