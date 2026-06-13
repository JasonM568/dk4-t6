import Link from "next/link";
import { prisma } from "@/lib/db";
import {
  listNeverSignedInUsers,
  getProfilesByEmails,
} from "@/lib/supabase/admin";
import { bulkSetPasswordAction } from "@/actions/admin";
import { pageGuardEditor } from "@/lib/auth/staff";
import { PasswordForm } from "./password-form";

export const metadata = { title: "未登入會員 — 管理後台" };

export default async function InactiveMembersPage() {
  await pageGuardEditor();
  const users = await listNeverSignedInUsers();

  // 補姓名（profiles）與課程權限數（course schema）
  const emails = users.map((u) => u.email).filter((e): e is string => !!e);
  const [profileMap, enrollCounts] = await Promise.all([
    getProfilesByEmails(emails),
    prisma.enrollment.groupBy({
      by: ["userId"],
      where: { userId: { in: users.map((u) => u.id) } },
      _count: { _all: true },
    }),
  ]);
  const countByUser = new Map(
    enrollCounts.map((c) => [c.userId, c._count._all]),
  );

  const rows = users
    .map((u) => ({
      id: u.id,
      email: u.email,
      name: u.email
        ? (profileMap.get(u.email.toLowerCase())?.display_name ?? null)
        : null,
      createdAt: u.createdAt,
      enrollmentCount: countByUser.get(u.id) ?? 0,
    }))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  return (
    <div className="max-w-4xl">
      <Link
        href="/admin/members"
        className="text-sm text-gray-500 hover:text-black"
      >
        ← 會員列表
      </Link>
      <h1 className="mb-1 mt-2 text-2xl font-bold">
        未登入會員（{rows.length} 位）
      </h1>
      <p className="mb-6 text-sm text-gray-500">
        這裡列出「從未登入過」的會員——通常是帳號被建立但學員還不知道密碼的那批。
        建議流程：勾選 → 設定一組密碼 → 用「群發通知」告訴學員登入方式。
      </p>

      <PasswordForm rows={rows} setAction={bulkSetPasswordAction} />
    </div>
  );
}
