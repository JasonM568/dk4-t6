import { requireEditor } from "@/lib/auth/staff";
import { buildCsv } from "@/lib/csv-export";
import { prisma } from "@/lib/db";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    await requireEditor();
  } catch {
    return new Response("Forbidden", { status: 403 });
  }
  const { id } = await params;
  const broadcast = await prisma.emailBroadcast.findUnique({
    where: { id },
    select: { id: true, sentAt: true },
  });
  if (!broadcast) return new Response("Not found", { status: 404 });

  const [recipients, events] = await Promise.all([
    prisma.emailBroadcastRecipient.findMany({
      where: { broadcastId: id },
      orderBy: { email: "asc" },
      select: {
        email: true,
        name: true,
        status: true,
        failureReason: true,
      },
    }),
    prisma.broadcastEvent.findMany({
      where: { broadcastId: id },
      select: { email: true, type: true },
    }),
  ]);
  const eventSet = new Set(events.map((event) => `${event.email}:${event.type}`));
  const csv = buildCsv([
    ["Email", "姓名", "Provider狀態", "送達", "開信", "點擊", "退信", "檢舉", "失敗原因"],
    ...recipients.map((recipient) => [
      recipient.email,
      recipient.name ?? "",
      recipient.status,
      eventSet.has(`${recipient.email}:DELIVERED`) ? "是" : "否",
      eventSet.has(`${recipient.email}:OPENED`) ? "是" : "否",
      eventSet.has(`${recipient.email}:CLICKED`) ? "是" : "否",
      eventSet.has(`${recipient.email}:BOUNCED`) ? "是" : "否",
      eventSet.has(`${recipient.email}:COMPLAINED`) ? "是" : "否",
      recipient.failureReason ?? "",
    ]),
  ]);
  const date = (broadcast.sentAt ?? new Date()).toISOString().slice(0, 10);
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="edm-recipients-${date}-${id}.csv"`,
      "Cache-Control": "private, no-store",
    },
  });
}
