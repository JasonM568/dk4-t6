import type { MergeStudent } from "@/lib/duplicate-students";

export type MergeStudentSnapshot = Omit<MergeStudent, "histories" | "engagements"> & {
  legacyAccessStatus: string;
  legacyNote: string | null;
  archivedAt: Date | null;
  archivedBy: string | null;
  archiveReason: string | null;
  claimedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  histories: (MergeStudent["histories"][number] & { source: string | null; note: string | null; createdAt: Date })[];
  engagements: (MergeStudent["engagements"][number] & { source: string | null; sourceRef: string | null; note: string | null; createdAt: Date })[];
};

export type StudentMergeSnapshot = {
  version: 1;
  source: MergeStudentSnapshot;
  targetBefore: MergeStudentSnapshot;
  targetAfterIdentity: StudentIdentitySnapshot;
  movedHistoryIds: string[];
  movedEngagementIds: string[];
  duplicateHistoryIds: string[];
  duplicateEngagementIds: string[];
};

export type StudentIdentitySnapshot = Pick<MergeStudentSnapshot,
  "name" | "email" | "phone" | "claimedUserId" | "claimedAt" | "legacyAccessStatus" | "legacyNote" | "archivedAt" | "archivedBy" | "archiveReason"
>;

const iso = (value: Date | string | null) => value ? new Date(value).toISOString() : null;
export function sameStudentIdentity(current: StudentIdentitySnapshot, expected: StudentIdentitySnapshot) {
  return current.name === expected.name && current.email === expected.email && current.phone === expected.phone
    && current.claimedUserId === expected.claimedUserId && iso(current.claimedAt) === iso(expected.claimedAt)
    && current.legacyAccessStatus === expected.legacyAccessStatus && current.legacyNote === expected.legacyNote
    && iso(current.archivedAt) === iso(expected.archivedAt) && current.archivedBy === expected.archivedBy
    && current.archiveReason === expected.archiveReason;
}

export function restoreSafetyConflicts(input: {
  sourceExists: boolean;
  currentTarget: StudentIdentitySnapshot | null;
  expectedTarget: StudentIdentitySnapshot;
  missingOrMovedHistoryIds: string[];
  missingOrMovedEngagementIds: string[];
  sourceIdentityClaimedElsewhere?: boolean;
}) {
  const conflicts: string[] = [];
  if (input.sourceExists) conflicts.push("來源學員卡 ID 已被重新使用");
  if (!input.currentTarget) conflicts.push("保留學員卡已不存在");
  else if (!sameStudentIdentity(input.currentTarget, input.expectedTarget)) conflicts.push("保留學員卡的身分資料在合併後曾被修改");
  if (input.missingOrMovedHistoryIds.length) conflicts.push(`${input.missingOrMovedHistoryIds.length} 筆已搬入課程紀錄後來被移動或刪除`);
  if (input.missingOrMovedEngagementIds.length) conflicts.push(`${input.missingOrMovedEngagementIds.length} 筆已搬入活動紀錄後來被移動或刪除`);
  if (input.sourceIdentityClaimedElsewhere) conflicts.push("來源卡的手機或會員身分已被其他學員卡使用");
  return conflicts;
}
