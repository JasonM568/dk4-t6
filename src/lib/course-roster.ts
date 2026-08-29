export type CourseRosterStatus =
  | "ENROLLED"
  | "PENDING_REGISTRATION"
  | "POSSIBLE_MISSING"
  | "UNRESOLVED_IDENTITY";

export type CourseRosterRow = {
  key: string;
  name: string | null;
  email: string | null;
  status: CourseRosterStatus;
  source: string;
  detail: string;
  userId: string | null;
};

type ProfileRow = { id: string; email: string | null; display_name: string | null };
type EnrollmentRow = { userId: string; createdAt: Date; source: string | null; orderId: string | null };
type PendingRow = { email: string; name: string | null; createdAt: Date };
type SourceRow = { id: string; name: string | null; email: string | null };

const emailKey = (value: string | null | undefined) => (value ?? "").trim().toLowerCase();
const nameKey = (value: string | null | undefined) => (value ?? "").replace(/\s+/g, "").toLowerCase();

export function findIdentityConflictEmails(rows: { email: string; name?: string | null }[]) {
  const namesByEmail = new Map<string, Set<string>>();
  for (const row of rows) {
    const email = emailKey(row.email);
    const name = nameKey(row.name);
    if (!email || !name) continue;
    const names = namesByEmail.get(email) ?? new Set<string>();
    names.add(name);
    namesByEmail.set(email, names);
  }
  return new Set([...namesByEmail].filter(([, names]) => names.size > 1).map(([email]) => email));
}

/**
 * 將 Auth profile、Enrollment、PendingEnrollment 與選定場次名單拼成唯讀狀態表。
 * 不做任何寫入；同 Email 不同姓名視為身分衝突，不猜測、也不自動授權。
 */
export function buildCourseRoster(input: {
  profiles: ProfileRow[];
  enrollments: EnrollmentRow[];
  pendings: PendingRow[];
  sourceRows?: SourceRow[];
  sourceLabel?: string;
}): CourseRosterRow[] {
  const profilesById = new Map(input.profiles.map((p) => [p.id, p]));
  const profilesByEmail = new Map(
    input.profiles.flatMap((p) => {
      const email = emailKey(p.email);
      return email ? [[email, p] as const] : [];
    }),
  );
  const enrolledByUser = new Map(input.enrollments.map((e) => [e.userId, e]));
  const pendingByEmail = new Map(input.pendings.map((p) => [emailKey(p.email), p]));
  const rows = new Map<string, CourseRosterRow>();

  for (const enrollment of input.enrollments) {
    const profile = profilesById.get(enrollment.userId);
    rows.set(`user:${enrollment.userId}`, {
      key: `user:${enrollment.userId}`,
      userId: enrollment.userId,
      name: profile?.display_name ?? null,
      email: profile?.email ?? null,
      status: "ENROLLED",
      source: "觀看權限",
      detail: "已正式開通影片",
    });
  }

  for (const pending of input.pendings) {
    const email = emailKey(pending.email);
    const profile = profilesByEmail.get(email);
    if (profile && enrolledByUser.has(profile.id)) continue;
    rows.set(profile ? `user:${profile.id}` : `email:${email}`, {
      key: profile ? `user:${profile.id}` : `email:${email}`,
      userId: profile?.id ?? null,
      name: pending.name ?? profile?.display_name ?? null,
      email,
      status: "PENDING_REGISTRATION",
      source: "待開通存底",
      detail: profile ? "帳號已出現，可重新執行開通完成認領" : "尚未註冊；使用同一 Email 註冊後自動開通",
    });
  }

  const sourceGroups = new Map<string, SourceRow[]>();
  for (const source of input.sourceRows ?? []) {
    const email = emailKey(source.email);
    if (!email) {
      rows.set(`source:${source.id}`, {
        key: `source:${source.id}`,
        userId: null,
        name: source.name,
        email: null,
        status: "UNRESOLVED_IDENTITY",
        source: input.sourceLabel ?? "來源名單",
        detail: "缺少 Email，無法對應會員或建立待開通",
      });
      continue;
    }
    const group = sourceGroups.get(email) ?? [];
    group.push(source);
    sourceGroups.set(email, group);
  }

  for (const [email, sources] of sourceGroups) {
    const distinctNames = new Set(sources.map((s) => nameKey(s.name)).filter(Boolean));
    if (distinctNames.size > 1) {
      rows.set(`conflict:${email}`, {
        key: `conflict:${email}`,
        userId: null,
        name: sources.map((s) => s.name).filter(Boolean).join("／") || null,
        email,
        status: "UNRESOLVED_IDENTITY",
        source: input.sourceLabel ?? "來源名單",
        detail: "同一 Email 對應不同姓名，未自動授權，請人工確認",
      });
      continue;
    }
    const source = sources[0];
    const profile = profilesByEmail.get(email);
    if (profile) {
      const key = `user:${profile.id}`;
      const enrolled = enrolledByUser.has(profile.id);
      rows.set(key, {
        key,
        userId: profile.id,
        name: source.name || profile.display_name,
        email,
        status: enrolled ? "ENROLLED" : "POSSIBLE_MISSING",
        source: input.sourceLabel ?? "來源名單",
        detail: enrolled ? "已在場次名單且影片已開通" : "已有會員帳號，但尚未開通這堂影片",
      });
      continue;
    }
    const pending = pendingByEmail.has(email);
    rows.set(`email:${email}`, {
      key: `email:${email}`,
      userId: null,
      name: source.name,
      email,
      status: pending ? "PENDING_REGISTRATION" : "POSSIBLE_MISSING",
      source: input.sourceLabel ?? "來源名單",
      detail: pending ? "尚未註冊，已建立待開通" : "尚未註冊，尚未建立待開通",
    });
  }

  const order: Record<CourseRosterStatus, number> = {
    UNRESOLVED_IDENTITY: 0,
    POSSIBLE_MISSING: 1,
    PENDING_REGISTRATION: 2,
    ENROLLED: 3,
  };
  return [...rows.values()].sort((a, b) => order[a.status] - order[b.status] || (a.name ?? a.email ?? "").localeCompare(b.name ?? b.email ?? "", "zh-Hant"));
}
