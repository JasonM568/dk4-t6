import assert from "node:assert/strict";
import { parseStudentMergePairs, restoreSafetyConflicts, sameStudentIdentity, type StudentIdentitySnapshot } from "../src/lib/student-merge-operation";

const identity: StudentIdentitySnapshot = { name: "王小明", email: "a@example.com", phone: null, claimedUserId: null, claimedAt: null,
  legacyAccessStatus: "UNKNOWN", legacyNote: null, archivedAt: null, archivedBy: null, archiveReason: null };
assert.equal(sameStudentIdentity(identity, { ...identity }), true);
assert.deepEqual(restoreSafetyConflicts({ sourceExists: false, currentTarget: identity, expectedTarget: identity,
  missingOrMovedHistoryIds: [], missingOrMovedEngagementIds: [] }), []);
const conflicts = restoreSafetyConflicts({ sourceExists: true, currentTarget: { ...identity, name: "已修改" }, expectedTarget: identity,
  missingOrMovedHistoryIds: ["h1"], missingOrMovedEngagementIds: ["e1"], sourceIdentityClaimedElsewhere: true });
assert.equal(conflicts.length, 5);
assert.deepEqual(parseStudentMergePairs(["source:target"]).pairs, [{ sourceId: "source", targetId: "target" }]);
assert.match(parseStudentMergePairs([]).error ?? "", /至少選擇/);
assert.match(parseStudentMergePairs(["a:b", "b:c"]).error ?? "", /同時作為來源與保留卡/);
assert.match(parseStudentMergePairs(Array.from({ length: 21 }, (_, i) => `s${i}:target`)).error ?? "", /最多合併 20/);
console.log("✓ student merge restore and batch safety checks passed");
