import type { Profile } from "@/lib/supabase/admin";
import { studentBulkDeleteStatus } from "@/lib/student-deletion";
import { detectTestListReasons } from "@/lib/test-list-candidate";

export type PersonFilter =
  | "ALL"
  | "REGISTERED"
  | "UNREGISTERED"
  | "ATTENDED_UNREGISTERED"
  | "PENDING_REGISTRATION"
  | "POSSIBLE_MISSING_ACCESS"
  | "HAS_ACCESS"
  | "LEGACY"
  | "LEAD"
  | "IDENTITY_CONFLICT"
  | "SAFE_TO_DELETE"
  | "SUSPECTED_TEST"
  | "ARCHIVED";

export type PersonFlag = Exclude<PersonFilter, "ALL" | "REGISTERED" | "UNREGISTERED">;

export type PersonSummary = {
  key: string;
  kind: "member" | "student" | "pending";
  userId: string | null;
  studentId: string | null;
  name: string;
  email: string | null;
  phone: string | null;
  registered: boolean;
  archived: boolean;
  historyCount: number;
  engagementCount: number;
  enrollmentCount: number;
  pendingCount: number;
  legacyAccessStatus: string;
  flags: PersonFlag[];
  candidateUserId: string | null;
  deleteStatus: "ELIGIBLE" | "PROTECTED" | "REVIEW" | "NOT_APPLICABLE";
  testCandidateReasons: string[];
};

export type PersonRosterInput = {
  profiles: Profile[];
  memberPhones: { userId: string; phone: string | null }[];
  students: {
    id: string; claimedUserId: string | null; name: string | null; email: string | null;
    phone: string | null; archivedAt: Date | null; legacyAccessStatus: string;
    historyCount: number; engagementCount: number;
  }[];
  enrollmentCounts: { userId: string; count: number }[];
  pending: { email: string; name: string | null; count: number }[];
  archivedUserIds?: string[];
};

const emailKey = (value: string | null | undefined) => value?.trim().toLowerCase() || null;
const displayName = (profile: Profile) => profile.display_name || profile.nickname || profile.email || "未命名會員";

function flagsFor(row: Omit<PersonSummary, "flags">, identityConflict = false): PersonFlag[] {
  const flags: PersonFlag[] = [];
  if (!row.registered && row.historyCount > 0) flags.push("ATTENDED_UNREGISTERED");
  if (row.pendingCount > 0) flags.push("PENDING_REGISTRATION");
  if (row.historyCount > 0 && row.enrollmentCount === 0) flags.push("POSSIBLE_MISSING_ACCESS");
  if (row.enrollmentCount > 0) flags.push("HAS_ACCESS");
  if (["ACTIVE", "TO_MIGRATE"].includes(row.legacyAccessStatus)) flags.push("LEGACY");
  if (row.historyCount === 0 && row.engagementCount > 0) flags.push("LEAD");
  if (identityConflict) flags.push("IDENTITY_CONFLICT");
  if (row.archived) flags.push("ARCHIVED");
  return flags;
}

/** 組成「人物」唯讀模型。只有 claimedUserId 會合併會員與歷史學員；email 僅提示候選，不自動合併。 */
export function buildPersonRoster(input: PersonRosterInput): PersonSummary[] {
  const profilesById = new Map(input.profiles.map((p) => [p.id, p]));
  const profilesByEmail = new Map<string, Profile[]>();
  for (const p of input.profiles) {
    const email = emailKey(p.email); if (!email) continue;
    profilesByEmail.set(email, [...(profilesByEmail.get(email) ?? []), p]);
  }
  const phoneByUser = new Map(input.memberPhones.map((r) => [r.userId, r.phone]));
  const enrollmentByUser = new Map(input.enrollmentCounts.map((r) => [r.userId, r.count]));
  const pendingByEmail = new Map(input.pending.map((r) => [emailKey(r.email)!, r]));
  const claimedUsers = new Set(input.students.map((s) => s.claimedUserId).filter(Boolean));
  const archivedUsers = new Set(input.archivedUserIds ?? []);
  const studentEmails = new Map<string, number>();
  for (const s of input.students) { const e = emailKey(s.email); if (e) studentEmails.set(e, (studentEmails.get(e) ?? 0) + 1); }
  const rows: PersonSummary[] = [];

  for (const s of input.students) {
    const profile = s.claimedUserId ? profilesById.get(s.claimedUserId) : undefined;
    const email = emailKey(s.email) ?? emailKey(profile?.email);
    const candidates = !s.claimedUserId && email ? (profilesByEmail.get(email) ?? []) : [];
    const pending = email ? pendingByEmail.get(email) : undefined;
    const base = {
      key: `student:${s.id}`, kind: "student" as const, userId: s.claimedUserId,
      studentId: s.id, name: s.name || (profile ? displayName(profile) : "未命名學員"),
      email, phone: s.phone ?? (s.claimedUserId ? phoneByUser.get(s.claimedUserId) ?? null : null),
      registered: Boolean(profile), archived: Boolean(s.archivedAt) || Boolean(s.claimedUserId && archivedUsers.has(s.claimedUserId)), historyCount: s.historyCount,
      engagementCount: s.engagementCount, enrollmentCount: s.claimedUserId ? enrollmentByUser.get(s.claimedUserId) ?? 0 : 0,
      pendingCount: pending?.count ?? 0, legacyAccessStatus: s.legacyAccessStatus,
      candidateUserId: candidates.length === 1 ? candidates[0].id : null,
    };
    const conflict = candidates.length > 1 || Boolean(email && (studentEmails.get(email) ?? 0) > 1);
    const protectedEnrollmentCount = [...new Set([s.claimedUserId, ...candidates.map((p) => p.id)].filter(Boolean))]
      .reduce((sum, userId) => sum + (enrollmentByUser.get(userId!) ?? 0), 0);
    const deleteStatus = studentBulkDeleteStatus({ enrollmentCount: protectedEnrollmentCount, identityConflict: conflict });
    const testCandidateReasons = detectTestListReasons({ name: s.name, email, historyCount: s.historyCount, engagementCount: s.engagementCount, pendingCount: base.pendingCount, enrollmentCount: protectedEnrollmentCount });
    const flags = flagsFor({ ...base, deleteStatus, testCandidateReasons }, conflict);
    if (testCandidateReasons.length) flags.push("SUSPECTED_TEST");
    rows.push({ ...base, deleteStatus, testCandidateReasons, flags });
    if (email) pendingByEmail.delete(email);
  }

  for (const p of input.profiles) {
    if (claimedUsers.has(p.id)) continue;
    const email = emailKey(p.email); const pending = email ? pendingByEmail.get(email) : undefined;
    const base = { key: `member:${p.id}`, kind: "member" as const, userId: p.id, studentId: null,
      name: displayName(p), email, phone: phoneByUser.get(p.id) ?? null, registered: true, archived: archivedUsers.has(p.id),
      historyCount: 0, engagementCount: 0, enrollmentCount: enrollmentByUser.get(p.id) ?? 0,
      pendingCount: pending?.count ?? 0, legacyAccessStatus: "UNKNOWN", candidateUserId: null, deleteStatus: "NOT_APPLICABLE" as const, testCandidateReasons: [] };
    rows.push({ ...base, flags: flagsFor(base, Boolean(email && (studentEmails.get(email) ?? 0) > 0)) });
    if (email) pendingByEmail.delete(email);
  }

  for (const [email, pending] of pendingByEmail) {
    const base = { key: `pending:${email}`, kind: "pending" as const, userId: null, studentId: null,
      name: pending.name || email, email, phone: null, registered: false, archived: false,
      historyCount: 0, engagementCount: 0, enrollmentCount: 0, pendingCount: pending.count,
      legacyAccessStatus: "UNKNOWN", candidateUserId: null, deleteStatus: "NOT_APPLICABLE" as const, testCandidateReasons: [] };
    rows.push({ ...base, flags: flagsFor(base) });
  }
  return rows;
}

export function personMatchesFilter(person: PersonSummary, filter: PersonFilter): boolean {
  if (filter === "ALL") return !person.archived;
  if (filter === "REGISTERED") return person.registered && !person.archived;
  if (filter === "UNREGISTERED") return !person.registered && !person.archived;
  if (filter === "SAFE_TO_DELETE") return person.deleteStatus === "ELIGIBLE";
  if (filter === "SUSPECTED_TEST") return person.testCandidateReasons.length > 0;
  return person.flags.includes(filter);
}

export function personMatchesQuery(person: PersonSummary, query: string): boolean {
  const q = query.trim().toLowerCase();
  return !q || [person.name, person.email, person.phone].some((v) => v?.toLowerCase().includes(q));
}
