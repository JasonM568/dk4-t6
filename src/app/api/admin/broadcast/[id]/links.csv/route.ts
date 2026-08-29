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
  const links = await prisma.broadcastLinkEvent.findMany({
    where: { broadcastId: id },
    orderBy: [{ url: "asc" }, { email: "asc" }],
    select: {
      url: true,
      email: true,
      firstClickedAt: true,
      lastClickedAt: true,
      clickCount: true,
    },
  });
  const csv = buildCsv([
    ["URL", "Email", "首次點擊", "最後點擊", "點擊次數"],
    ...links.map((link) => [
      link.url,
      link.email,
      link.firstClickedAt.toISOString(),
      link.lastClickedAt.toISOString(),
      link.clickCount,
    ]),
  ]);
  const date = (broadcast.sentAt ?? new Date()).toISOString().slice(0, 10);
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="edm-links-${date}-${id}.csv"`,
      "Cache-Control": "private, no-store",
    },
  });
}
