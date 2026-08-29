import assert from "node:assert/strict";
import { buildCourseRoster, findIdentityConflictEmails } from "../src/lib/course-roster";

const now = new Date("2026-08-29T00:00:00Z");
const rows = buildCourseRoster({
  profiles: [
    { id: "u-enrolled", email: "done@example.com", display_name: "已開通" },
    { id: "u-missing", email: "missing@example.com", display_name: "漏開通" },
  ],
  enrollments: [
    { userId: "u-enrolled", createdAt: now, source: "BATCH", orderId: null },
  ],
  pendings: [
    { email: "pending@example.com", name: "待註冊", createdAt: now },
  ],
  sourceLabel: "測試場次",
  sourceRows: [
    { id: "s1", name: "已開通", email: "DONE@example.com" },
    { id: "s2", name: "漏開通", email: "missing@example.com" },
    { id: "s3", name: "待註冊", email: "pending@example.com" },
    { id: "s4", name: "沒有信箱", email: null },
    { id: "s5", name: "甲", email: "shared@example.com" },
    { id: "s6", name: "乙", email: "shared@example.com" },
  ],
});

const byEmail = new Map(rows.filter((r) => r.email).map((r) => [r.email, r]));
assert.equal(byEmail.get("done@example.com")?.status, "ENROLLED");
assert.equal(byEmail.get("missing@example.com")?.status, "POSSIBLE_MISSING");
assert.equal(byEmail.get("pending@example.com")?.status, "PENDING_REGISTRATION");
assert.equal(byEmail.get("shared@example.com")?.status, "UNRESOLVED_IDENTITY");
assert.equal(rows.find((r) => r.name === "沒有信箱")?.status, "UNRESOLVED_IDENTITY");
assert.equal(new Set(rows.map((r) => r.key)).size, rows.length, "每列 key 必須唯一");
assert.deepEqual(
  [...findIdentityConflictEmails([
    { email: "shared@example.com", name: "甲" },
    { email: "SHARED@example.com", name: " 乙 " },
    { email: "same@example.com", name: "王 小明" },
    { email: "same@example.com", name: "王小明" },
  ])],
  ["shared@example.com"],
  "只有同 Email 不同姓名才應阻擋；空白與大小寫不造成假衝突",
);
console.log("✓ course roster classification passed");
