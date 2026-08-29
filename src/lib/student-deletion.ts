export function studentDeleteConfirmation(name: string | null, email: string | null) {
  return name?.trim() || email?.trim().toLowerCase() || "DELETE";
}

export function canPermanentlyDeleteStudent(input: {
  linkedOrCandidateEnrollmentCount: number;
}) {
  return input.linkedOrCandidateEnrollmentCount === 0;
}
