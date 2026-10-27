import Link from "next/link";
import { CHANCELLOR } from "@/lib/site-content/about";

// 院長介紹區塊：首頁（compact，附「關於我們」連結）與 /about 共用，文案照舊官網。
export function ChancellorIntro({ compact = false }: { compact?: boolean }) {
  return (
    <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white">
      <div className="grid md:grid-cols-2">
        {/* 舊站這張照片右下角本身就印了「顧及然 院長」名牌，不另外疊字；object-top 讓高欄位裁切時留住頭部 */}
        <div className="min-h-72 bg-slate-900 md:order-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={CHANCELLOR.photo} alt={`${CHANCELLOR.name} ${CHANCELLOR.title}`} className="h-full w-full object-cover object-top" />
        </div>
        <div className="p-6 sm:p-8 md:order-1">
          <div className="text-5xl leading-none text-indigo-200" aria-hidden>“</div>
          {CHANCELLOR.quote.map((p) => (
            <p key={p} className="mt-3 text-sm leading-relaxed text-gray-700 sm:text-base">{p}</p>
          ))}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={CHANCELLOR.signature} alt={`${CHANCELLOR.name} 簽名`} className="ml-auto mt-4 h-14 w-auto" />
          {!compact && (
            <div className="mt-6 grid gap-6 sm:grid-cols-2">
              <div className="border-l-4 border-indigo-300 pl-4">
                <div className="mb-2 font-bold text-indigo-700">現任</div>
                <ul className="space-y-1 text-sm text-gray-700">
                  {CHANCELLOR.current.map((x) => <li key={x}>{x}</li>)}
                </ul>
              </div>
              <div className="border-l-4 border-indigo-300 pl-4">
                <div className="mb-2 font-bold text-indigo-700">曾任</div>
                <ul className="space-y-1 text-sm text-gray-700">
                  {CHANCELLOR.past.map((x) => <li key={x}>{x}</li>)}
                </ul>
              </div>
            </div>
          )}
          {compact && (
            <Link href="/about" className="mt-6 inline-block rounded-lg border border-gray-300 px-5 py-2 text-sm font-medium transition hover:bg-gray-50">
              認識希望學院 →
            </Link>
          )}
        </div>
      </div>
    </div>
  );
}
