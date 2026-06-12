import Link from "next/link";

// 量子講師群/知識專區/講座邀約 三個分頁的共用版面。
// 內容尚未定稿，先以品牌化「籌備中」呈現；之後各頁有正式內容時改傳 children。
export function SitePageShell({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle: string;
  children?: React.ReactNode;
}) {
  return (
    <div>
      <section className="bg-gradient-to-b from-indigo-50 to-white">
        <div className="mx-auto max-w-6xl px-4 py-16 text-center">
          <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">
            {title}
          </h1>
          <p className="mx-auto mt-4 max-w-2xl text-lg text-gray-600">
            {subtitle}
          </p>
        </div>
      </section>
      <section className="mx-auto max-w-6xl px-4 py-12">
        {children ?? (
          <div className="rounded-xl border border-dashed border-gray-300 px-6 py-16 text-center">
            <p className="text-lg font-medium text-gray-500">內容籌備中</p>
            <p className="mt-2 text-sm text-gray-400">
              我們正在整理這個專區的內容，敬請期待。
            </p>
            <Link
              href="/courses"
              className="mt-6 inline-block rounded-lg bg-black px-6 py-3 text-sm font-medium text-white transition hover:bg-gray-800"
            >
              先去看看課程
            </Link>
          </div>
        )}
      </section>
    </div>
  );
}
