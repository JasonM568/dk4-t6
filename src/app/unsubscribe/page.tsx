import Link from "next/link";
import { verifyUnsubscribeToken } from "@/lib/email/unsubscribe";
import { UnsubscribeConfirmForm } from "./confirm-form";

export const metadata = { title: "取消訂閱 — 希望學院學習平台" };

// 公開頁（proxy matcher 不含此路徑）；連結來自信件 footer，帶 email + HMAC token
export default async function UnsubscribePage({
  searchParams,
}: {
  searchParams: Promise<{ email?: string; token?: string; done?: string }>;
}) {
  const { email = "", token = "", done } = await searchParams;

  if (done === "1") {
    return (
      <Shell>
        <div className="text-4xl">✅</div>
        <h1 className="mt-3 text-xl font-bold">已完成退訂</h1>
        <p className="mt-2 text-sm text-gray-600">
          您將不會再收到希望學院的電子報。若日後想重新訂閱，請聯繫我們。
        </p>
        <Link
          href="/"
          className="mt-6 inline-block rounded-lg border border-gray-300 px-4 py-2 text-sm hover:bg-gray-50"
        >
          回首頁
        </Link>
      </Shell>
    );
  }

  if (!email || !token || !verifyUnsubscribeToken(email, token)) {
    return (
      <Shell>
        <div className="text-4xl">⚠️</div>
        <h1 className="mt-3 text-xl font-bold">連結無效</h1>
        <p className="mt-2 text-sm text-gray-600">
          此退訂連結無效或不完整，請使用信件底部的「取消訂閱」連結再試一次。
        </p>
        <Link
          href="/"
          className="mt-6 inline-block rounded-lg border border-gray-300 px-4 py-2 text-sm hover:bg-gray-50"
        >
          回首頁
        </Link>
      </Shell>
    );
  }

  return (
    <Shell>
      <h1 className="text-xl font-bold">取消訂閱電子報</h1>
      <p className="mt-2 text-sm text-gray-600">
        確定要讓 <span className="font-medium text-gray-900">{email}</span>{" "}
        停止接收希望學院的電子報嗎？
      </p>
      <UnsubscribeConfirmForm email={email} token={token} />
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto flex min-h-[70vh] max-w-md flex-col justify-center px-4 py-12 text-center">
      <div className="rounded-2xl border border-gray-200 bg-white p-8 shadow-sm">
        {children}
      </div>
    </div>
  );
}
