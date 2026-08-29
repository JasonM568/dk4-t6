import assert from "node:assert/strict";
import { detectTestListReasons } from "../src/lib/test-list-candidate";

const empty = { historyCount: 0, engagementCount: 0, pendingCount: 0, enrollmentCount: 0 };
assert.ok(detectTestListReasons({ ...empty, name: "測試帳號", email: "real@gmail.com" }).length > 0);
assert.ok(detectTestListReasons({ ...empty, name: "王小明", email: "demo@example.com" }).length > 0);
assert.deepEqual(detectTestListReasons({ ...empty, name: "王小明", email: "real@gmail.com" }), [], "只有空足跡不應把真人自動列成測試候選");
assert.deepEqual(detectTestListReasons({ name: "王小明", email: "real@gmail.com", historyCount: 1, engagementCount: 0, pendingCount: 0, enrollmentCount: 0 }), []);
console.log("✓ suspected test-list candidate heuristics passed");
