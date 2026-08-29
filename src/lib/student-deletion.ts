export function studentDeleteConfirmation(name: string | null, email: string | null) {
  return name?.trim() || email?.trim().toLowerCase() || "DELETE";
}

export function canPermanentlyDeleteStudent(input: {
  linkedOrCandidateEnrollmentCount: number;
}) {
  return input.linkedOrCandidateEnrollmentCount === 0;
}

export function studentBulkDeleteStatus(input: { enrollmentCount: number; identityConflict: boolean }) {
  if (input.enrollmentCount > 0) return "PROTECTED" as const;
  if (input.identityConflict) return "REVIEW" as const;
  return "ELIGIBLE" as const;
}
