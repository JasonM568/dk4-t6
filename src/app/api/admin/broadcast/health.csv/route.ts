import { requireEditor } from "@/lib/auth/staff";
import { buildCsv } from "@/lib/csv-export";
import { getMailHealth, parseHealthFilter } from "@/lib/email/health";

export async function GET(request: Request) {
  try { await requireEditor(); } catch { return new Response("Forbidden", { status: 403 }); }
  const url = new URL(request.url);
  const filter = parseHealthFilter(url.searchParams.get("status") ?? undefined);
  const data = await getMailHealth(filter, url.searchParams.get("q") ?? "");
  const csv = buildCsv([
    ["Email", "狀態", "原因", "時間"],
    ...data.rows.map((row) => [row.email, row.status, row.reason ?? "", row.occurredAt.toISOString()]),
  ]);
  return new Response(csv, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="edm-health-${filter}.csv"`, "Cache-Control": "private, no-store" } });
}
