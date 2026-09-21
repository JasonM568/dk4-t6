import { requireEditor } from "@/lib/auth/staff";
import { buildCsv } from "@/lib/csv-export";
import { prisma } from "@/lib/db";
import { formatMobile } from "@/lib/sms/phone";

/** 講座索取名單 CSV。
 *
 *  在這之前，講座名單唯一的「匯出」是「複製手機名單」——只給手機＋姓名，
 *  沒填手機的整筆拿不到、email 一個都拿不到。實務上要對名單、寄信、
 *  交給別人處理時就只能一筆一筆抄。
 *
 *  含 email（經 Jason 明確確認）：不含的話這份檔案等於沒用。
 *  被蜜罐擋下的那幾筆一併列出但**另開一欄標記**——他們看到的是「已寄出」，
 *  實際沒收到信也沒進名單，混進正常名單會讓人以為已經通知到了，
 *  整批排除又會讓這些人永遠沒人發現。 */
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
  const webinar = await prisma.webinar.findUnique({
    where: { id },
    select: { id: true, slug: true, title: true },
  });
  if (!webinar) return new Response("Not found", { status: 404 });

  const [requests, blocked] = await Promise.all([
    prisma.webinarRequest.findMany({
      where: { webinarId: id },
      orderBy: { createdAt: "asc" },
      select: {
        email: true,
        name: true,
        phone: true,
        createdAt: true,
        sentCount: true,
        deliveryStatus: true,
        deliveryDetail: true,
        smsNoticeAt: true,
      },
    }),
    // 未處理的才列：已補寄／已確認是機器人的（resolvedAt 有值）不該再混進名單
    prisma.webinarBlockedAttempt.findMany({
      where: { webinarId: id, resolvedAt: null },
      orderBy: { createdAt: "asc" },
      select: { email: true, name: true, phone: true, createdAt: true, reason: true },
    }),
  ]);

  const tpe = (d: Date | null) =>
    d
      ? d.toLocaleString("zh-TW", {
          timeZone: "Asia/Taipei",
          hour12: false,
          dateStyle: "short",
          timeStyle: "short",
        })
      : "";

  const csv = buildCsv([
    [
      "姓名",
      "Email",
      "手機",
      "索取時間",
      "寄送狀態",
      "失敗原因",
      "寄送次數",
      "簡訊已通知",
      "被擋下",
    ],
    ...requests.map((r) => [
      r.name ?? "",
      r.email,
      // 前面補 ' 讓試算表保留開頭的 0（csvCell 已處理 = + - @，但 09 開頭會被吃成數字）
      r.phone ? `'${formatMobile(r.phone)}` : "",
      tpe(r.createdAt),
      r.deliveryStatus ?? "",
      r.deliveryDetail ?? "",
      r.sentCount,
      r.smsNoticeAt ? tpe(r.smsNoticeAt) : "",
      "",
    ]),
    ...blocked.map((b) => [
      b.name ?? "",
      b.email ?? "",
      b.phone ? `'${formatMobile(b.phone)}` : "",
      tpe(b.createdAt),
      "",
      "",
      "",
      "",
      // 這一欄就是差別：對方看到「已寄出」，實際沒收到信也沒進名單
      `⚠️ 被擋下（${b.reason}）未補寄`,
    ]),
  ]);

  const stamp = new Date().toISOString().slice(0, 10);
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="webinar-${webinar.slug}-${stamp}.csv"`,
      "Cache-Control": "private, no-store",
    },
  });
}
