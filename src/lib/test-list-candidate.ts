export function detectTestListReasons(input: { name: string | null; email: string | null; historyCount: number; engagementCount: number; pendingCount: number; enrollmentCount: number }) {
  const reasons: string[] = [];
  const name = input.name?.trim().toLowerCase() ?? "";
  const email = input.email?.trim().toLowerCase() ?? "";
  if (/(^|[\s_-])(test|demo|測試|範例)([\s_-]|$)/i.test(name) || /測試|範例/.test(name)) reasons.push("姓名含測試／範例標記");
  if (email && (/(^|[._+-])(test|demo|fake)([._+-]|@)/.test(email) || /@(example\.(com|org|net)|test\.)/.test(email))) reasons.push("Email 含測試／範例標記");
  if (input.historyCount === 0 && input.engagementCount === 0 && input.pendingCount === 0 && input.enrollmentCount === 0) reasons.push("沒有課程、活動、待開通或影片資料");
  return reasons.length >= 2 || reasons.some((r) => r.includes("測試／範例標記")) ? reasons : [];
}
