export const compactName = (value: string | null | undefined) => (value ?? "").replace(/\s+/g, "").toLowerCase();
export const compatibleName = (a: string | null | undefined, b: string | null | undefined) => !compactName(a) || !compactName(b) || compactName(a) === compactName(b);

export type HistorySyncPreview = { signupId: string; name: string; email: string | null; phone: string | null; studentId: string | null; status: "READY" | "ALREADY" | "NO_CONTACT" | "CONFLICT" };

export function buildSessionHistoryPreview(input: {
  signups: { id: string; name: string; email: string | null; phone: string | null }[];
  students: { id: string; name: string | null; email: string | null; phone: string | null }[];
  existingStudentIds: Set<string>;
}): HistorySyncPreview[] {
  return input.signups.map((signup) => {
    const base = { signupId: signup.id, name: signup.name, email: signup.email, phone: signup.phone };
    const phoneMatches = signup.phone ? input.students.filter((s) => s.phone === signup.phone) : [];
    const emailMatches = signup.email ? input.students.filter((s) => s.email?.toLowerCase() === signup.email?.toLowerCase()) : [];
    const candidates = [...new Map([...phoneMatches, ...emailMatches].map((s) => [s.id, s])).values()];
    const compatible = candidates.filter((s) => compatibleName(s.name, signup.name));
    if (!signup.phone && !signup.email) return { ...base, studentId: null, status: "NO_CONTACT" };
    if (compatible.length > 1 || (candidates.length > 0 && compatible.length === 0)) return { ...base, studentId: null, status: "CONFLICT" };
    const studentId = compatible[0]?.id ?? null;
    return { ...base, studentId, status: studentId && input.existingStudentIds.has(studentId) ? "ALREADY" : "READY" };
  });
}
