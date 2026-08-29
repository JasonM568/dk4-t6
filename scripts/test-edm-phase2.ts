/* EDM Phase 2 純函式測試：KPI、CSV 安全、寄送前檢查。 */
import { calculateBroadcastMetrics, formatMetricRate } from "../src/lib/email/analytics";
import { buildCsv } from "../src/lib/csv-export";
import { inspectBroadcastDraft } from "../src/lib/email/preflight";
import { resolvePerformanceEmails } from "../src/lib/email/performance-segment";

let passed = 0;
let failed = 0;
const check = (name: string, ok: boolean) => {
  if (ok) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.error(`  ✗ ${name}`); }
};

console.log("\n成效指標");
const metrics = calculateBroadcastMetrics({ sentCount: 10, delivered: 9, opened: 8, clicked: 3, bounced: 1, complained: 0 });
check("送達率以 ACCEPTED 為分母", metrics.deliveryRate === 0.9);
check("點擊率以 ACCEPTED 為分母", metrics.clickRate === 0.3);
check("分母 0 顯示 —", formatMetricRate(calculateBroadcastMetrics({ sentCount: 0, delivered: 0, opened: 0, clicked: 0, bounced: 0, complained: 0 }).clickRate) === "—");

console.log("\nCSV");
const csv = buildCsv([["姓名", "備註"], ["王小明", "逗號,雙引號\"與\n換行"], ["危險", "=SUM(A1:A2)"]]);
check("包含 UTF-8 BOM", csv.startsWith("\uFEFF"));
check("RFC 4180 雙引號跳脫", csv.includes('"逗號,雙引號""與\n換行"'));
check("公式注入前置單引號", csv.includes("'=SUM(A1:A2)"));

console.log("\n寄送前檢查");
const invalid = inspectBroadcastDraft({ subject: "", body: "您好 {unknown}\n\n[按鈕](javascript:bad)" });
check("空主旨阻擋", invalid.errors.some((error) => error.includes("主旨")));
check("未知變數阻擋", invalid.errors.some((error) => error.includes("{unknown}")));
check("非 http(s) 連結阻擋", invalid.errors.some((error) => error.includes("連結格式")));
const warning = inspectBroadcastDraft({ subject: "這是主旨", body: "TODO 請填寫活動內容" });
check("沒有 CTA 警告", warning.warnings.some((item) => item.includes("CTA")));
check("placeholder 警告", warning.warnings.some((item) => item.includes("placeholder")));
const valid = inspectBroadcastDraft({ subject: "開課通知", body: "親愛的 {name}\n\n[查看](https://example.com)" });
check("合法內容無阻擋", valid.errors.length === 0);

console.log("\n成效名單");
const accepted = ["clicked@example.com", "quiet@example.com", "bounce@example.com"];
const events = [{ email: "clicked@example.com", type: "CLICKED" }, { email: "bounce@example.com", type: "BOUNCED" }];
check("已點擊只取 ACCEPTED 事件", resolvePerformanceEmails("CLICKED", accepted, events).join() === "clicked@example.com");
check("未點擊排除退信", resolvePerformanceEmails("NOT_CLICKED", accepted, events).join() === "quiet@example.com");
check("未互動排除點擊與退信", resolvePerformanceEmails("INACTIVE", accepted, events).join() === "quiet@example.com");

console.log(failed === 0 ? `\n全部通過（${passed} 項）` : `\n${failed} 項失敗（${passed} 項通過）`);
process.exit(failed === 0 ? 0 : 1);
