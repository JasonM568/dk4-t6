import assert from "node:assert/strict";
import { restoreSafetyConflicts, sameStudentIdentity, type StudentIdentitySnapshot } from "../src/lib/student-merge-operation";

const identity: StudentIdentitySnapshot = { name: "王小明", email: "a@example.com", phone: null, claimedUserId: null, claimedAt: null,
  legacyAccessStatus: "UNKNOWN", legacyNote: null, archivedAt: null, archivedBy: null, archiveReason: null };
assert.equal(sameStudentIdentity(identity, { ...identity }), true);
assert.deepEqual(restoreSafetyConflicts({ sourceExists: false, currentTarget: identity, expectedTarget: identity,
  missingOrMovedHistoryIds: [], missingOrMovedEngagementIds: [] }), []);
const conflicts = restoreSafetyConflicts({ sourceExists: true, currentTarget: { ...identity, name: "已修改" }, expectedTarget: identity,
  missingOrMovedHistoryIds: ["h1"], missingOrMovedEngagementIds: ["e1"], sourceIdentityClaimedElsewhere: true });
assert.equal(conflicts.length, 5);
console.log("✓ student merge restore safety checks passed");
