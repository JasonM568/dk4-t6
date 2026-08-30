import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { requireStaff } from "@/lib/auth/staff";
import { SIGNUP_REQUEST_STATUS, parseDmBlocks } from "@/lib/session-signup-page";
import { SignupPageForm } from "./signup-page-form";
import { PendingRequests, type PendingOrder } from "./pending-requests";

export const dynamic = "force-dynamic";

export default async function SessionSignupPageAdmin({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireStaff();
  const { id } = await params;

  const [session, groups, canonicalCourses, requests, confirmedCount] = await Promise.all([
    prisma.courseSession.findUnique({ where: { id } }),
    prisma.mailGroup.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
    prisma.canonicalCourse.findMany({
      orderBy: { sortOrder: "asc" },
      select: { id: true, name: true, kind: true },
    }),
    prisma.sessionSignupRequest.findMany({
      where: { sessionId: id, status: SIGNUP_REQUEST_STATUS.PENDING },
      orderBy: [{ createdAt: "desc" }, { attendeeKey: "asc" }],
    }),
    prisma.sessionSignup.count({ where: { sessionId: id, deferredToSessionId: null } }),
  ]);
  if (!session) notFound();

  // 一張訂單一個卡片：確認收款是「整筆報名」的動作，不是逐人的
  const byOrder = new Map<string, PendingOrder>();
  for (const r of requests) {
    const entry = byOrder.get(r.orderNo) ?? {
      orderNo: r.orderNo,
      buyerName: r.buyerName,
      buyerEmail: r.buyerEmail,
      buyerPhone: r.buyerPhone,
      note: null as string | null,
      createdAt: r.createdAt.toISOString(),
      attendees: [],
    };
    if (r.note) entry.note = r.note;
    entry.attendees.push({
      name: r.name,
      phone: r.phone,
      email: r.email,
      meal: r.meal,
      isRetrain: r.isRetrain,
    });
    byOrder.set(r.orderNo, entry);
  }

  return (
    <div className="mx-auto max-w-3xl space-y-8 px-4 py-8">
      <div>
        <Link href="/admin/sessions" className="text-sm text-gray-500 hover:underline">
          ← 回場次看板管理
        </Link>
        <h1 className="mt-2 text-2xl font-bold">{session.title}</h1>
        <p className="mt-1 text-sm text-gray-500">
          公開報名頁設定 ｜ 目前正式名單 {confirmedCount} 人、待確認 {requests.length} 人
        </p>
      </div>

      {/* 導去 1shop 時不會有待確認報名，整塊收起來免得干擾；
          先前用平台報名收過的資料還在就照常顯示，不會被藏掉 */}
      {(!session.signupUrl || byOrder.size > 0) && (
        <PendingRequests sessionId={id} orders={[...byOrder.values()]} />
      )}

      <SignupPageForm
        sessionId={id}
        groups={groups}
        canonicalCourses={canonicalCourses}
        initial={{
          signupSlug: session.signupSlug,
          isSignupOpen: session.isSignupOpen,
          signupUrl: session.signupUrl,
          signupPayMode: session.signupPayMode,
          signupPrice: session.signupPrice,
          signupListPrice: session.signupListPrice,
          signupRetrainPrice: session.signupRetrainPrice,
          signupRetrainCourseIds: session.signupRetrainCourseIds,
          dmImage: session.dmImage,
          // DB 的 Json 是 unknown，在伺服器端解析一次再往下傳
          dmBlocks: parseDmBlocks(session.dmBlocks),
          signupIntro: session.signupIntro,
          venue: session.venue,
          address: session.address,
          signupOpenAt: session.signupOpenAt?.toISOString() ?? null,
          signupCloseAt: session.signupCloseAt?.toISOString() ?? null,
          signupQuota: session.signupQuota,
          signupPriceNote: session.signupPriceNote,
          signupPayNote: session.signupPayNote,
          signupNotice: session.signupNotice,
          signupGroupId: session.signupGroupId,
        }}
      />
    </div>
  );
}
