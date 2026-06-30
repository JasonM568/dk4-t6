"use client";

// 後台錯誤邊界：任何 server component / server action 拋出未攔截的例外時，
// 顯示可復原的友善畫面，取代 Next.js 內建那句沒頭沒尾的「This page couldn't load」。
// 註：redirect() / notFound() 由框架特別處理，不會被這裡攔截。
export default function AdminError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="mx-auto max-w-lg py-16 text-center">
      <h1 className="text-xl font-bold">這個頁面載入時出錯了</h1>
      <p className="mt-2 text-sm text-gray-500">
        可以先按「重新整理」再試一次。若反覆出現，請把下方代碼回報給工程師。
      </p>
      {error.digest && (
        <p className="mt-1 font-mono text-xs text-gray-400">
          錯誤代碼：{error.digest}
        </p>
      )}
      <div className="mt-6 flex justify-center gap-3">
        <button
          onClick={() => reset()}
          className="rounded-lg bg-black px-5 py-2.5 text-sm font-medium text-white"
        >
          重新整理
        </button>
        <a
          href="/admin"
          className="rounded-lg border border-gray-300 px-5 py-2.5 text-sm font-medium"
        >
          回後台首頁
        </a>
      </div>
    </div>
  );
}
