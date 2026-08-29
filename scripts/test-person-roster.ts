import assert from "node:assert/strict";
import { buildPersonRoster, personMatchesFilter } from "../src/lib/person-roster";

const rows = buildPersonRoster({
  profiles: [
    { id: "u-claimed", email: "claimed@example.com", display_name: "已認領", nickname: null, role: "student" },
    { id: "u-shared", email: "shared@example.com", display_name: "共用信箱會員", nickname: null, role: "student" },
    { id: "u-video", email: "video@example.com", display_name: "有影片", nickname: null, role: "student" },
    { id: "u-archived", email: "old@example.com", display_name: "封存會員", nickname: null, role: "student" },
  ],
  memberPhones: [], archivedUserIds: ["u-archived"],
  students: [
    { id: "s-claimed", claimedUserId: "u-claimed", name: "已認領", email: "claimed@example.com", phone: null, archivedAt: null, legacyAccessStatus: "NONE", historyCount: 2, engagementCount: 0 },
    { id: "s-shared-a", claimedUserId: null, name: "甲", email: "shared@example.com", phone: null, archivedAt: null, legacyAccessStatus: "ACTIVE", historyCount: 1, engagementCount: 0 },
    { id: "s-shared-b", claimedUserId: null, name: "乙", email: "shared@example.com", phone: null, archivedAt: null, legacyAccessStatus: "UNKNOWN", historyCount: 0, engagementCount: 1 },
    { id: "s-safe", claimedUserId: null, name: "測試名單", email: "safe@example.com", phone: null, archivedAt: null, legacyAccessStatus: "NONE", historyCount: 0, engagementCount: 0 },
  ],
  enrollmentCounts: [{ userId: "u-claimed", count: 1 }, { userId: "u-video", count: 2 }],
  pending: [{ email: "pending@example.com", name: "待註冊", count: 1 }],
});

assert.equal(rows.filter((r) => r.userId === "u-claimed").length, 1, "claimedUserId 應合併為一列");
assert.equal(rows.filter((r) => r.email === "shared@example.com").length, 3, "共用 Email 不得自動合併兩張學員卡與會員");
assert.ok(rows.filter((r) => r.email === "shared@example.com").every((r) => r.flags.includes("IDENTITY_CONFLICT")));
assert.equal(rows.find((r) => r.studentId === "s-shared-a")?.candidateUserId, "u-shared", "唯一會員帳號只列為候選");
assert.ok(rows.find((r) => r.studentId === "s-shared-a")?.flags.includes("ATTENDED_UNREGISTERED"));
assert.ok(rows.find((r) => r.studentId === "s-shared-a")?.flags.includes("POSSIBLE_MISSING_ACCESS"));
assert.ok(rows.find((r) => r.studentId === "s-shared-b")?.flags.includes("LEAD"));
assert.ok(rows.find((r) => r.kind === "pending")?.flags.includes("PENDING_REGISTRATION"));
assert.ok(personMatchesFilter(rows.find((r) => r.userId === "u-video")!, "HAS_ACCESS"));
assert.ok(personMatchesFilter(rows.find((r) => r.userId === "u-archived")!, "ARCHIVED"));
assert.ok(!personMatchesFilter(rows.find((r) => r.userId === "u-archived")!, "ALL"), "一般列表需排除封存會員");
assert.equal(rows.find((r) => r.studentId === "s-claimed")?.deleteStatus, "PROTECTED", "已認領且有影片必須禁止批次刪除");
assert.equal(rows.find((r) => r.studentId === "s-shared-a")?.deleteStatus, "REVIEW", "共用 Email 必須改為人工確認");
assert.equal(personMatchesFilter(rows.find((r) => r.studentId === "s-shared-a")!, "SAFE_TO_DELETE"), false);
assert.equal(rows.find((r) => r.studentId === "s-safe")?.deleteStatus, "ELIGIBLE");
assert.ok(personMatchesFilter(rows.find((r) => r.studentId === "s-safe")!, "SAFE_TO_DELETE"));
console.log("✓ person roster identity, filters and task flags passed");
