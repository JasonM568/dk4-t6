import assert from "node:assert/strict";
import { canPermanentlyDeleteStudent, studentBulkDeleteStatus, studentDeleteConfirmation } from "../src/lib/student-deletion";

assert.equal(canPermanentlyDeleteStudent({ linkedOrCandidateEnrollmentCount: 0 }), true, "沒有影片權限才可刪除名單卡");
assert.equal(canPermanentlyDeleteStudent({ linkedOrCandidateEnrollmentCount: 1 }), false, "任一影片權限都必須阻擋刪除");
assert.equal(canPermanentlyDeleteStudent({ linkedOrCandidateEnrollmentCount: 8 }), false);
assert.equal(studentDeleteConfirmation(" 王小明 ", "x@example.com"), "王小明");
assert.equal(studentDeleteConfirmation(null, "USER@Example.com"), "user@example.com");
assert.equal(studentDeleteConfirmation(null, null), "DELETE");
assert.equal(studentBulkDeleteStatus({ enrollmentCount: 1, identityConflict: true }), "PROTECTED", "影片權限優先阻擋");
assert.equal(studentBulkDeleteStatus({ enrollmentCount: 0, identityConflict: true }), "REVIEW");
assert.equal(studentBulkDeleteStatus({ enrollmentCount: 0, identityConflict: false }), "ELIGIBLE");
console.log("✓ student permanent deletion policy passed");
