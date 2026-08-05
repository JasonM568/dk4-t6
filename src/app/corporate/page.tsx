import { CorporateInquiryForm } from "./inquiry-form";

export const metadata = {
  title: "企業包班諮詢 — 希望學院學習平台",
  description:
    "為企業與團隊量身打造 AI 課程：客製化課綱、實體或線上授課、實戰演練。留下需求，1–2 個工作天內專人聯繫。",
};

const FEATURES = [
  {
    icon: "🎯",
    title: "客製化課綱",
    desc: "依產業與團隊現況調整教材與案例，從入門體驗到進階應用都能安排。",
  },
  {
    icon: "🏢",
    title: "到府／線上皆可",
    desc: "可到貴公司實體授課，也可線上直播開課，混合形式亦可討論。",
  },
  {
    icon: "🛠️",
    title: "實戰演練導向",
    desc: "課堂直接操作 AI 工具解決工作情境，學完隔天就能用在業務上。",
  },
] as const;

const STEPS = [
  { step: "1", title: "填寫需求", desc: "留下基本資料與包班需求" },
  { step: "2", title: "專人聯繫", desc: "1–2 個工作天內電話或 Email 聯繫" },
  { step: "3", title: "客製提案", desc: "依需求提供課綱、時數與報價" },
  { step: "4", title: "確認開課", desc: "敲定日期，講師與教材就緒開課" },
] as const;

export default function CorporatePage() {
  return (
    <div>
      <section className="bg-gradient-to-b from-indigo-50 to-white">
        <div className="mx-auto max-w-6xl px-4 py-16 text-center">
          <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">
            企業包班諮詢
          </h1>
          <p className="mx-auto mt-4 max-w-2xl text-lg text-gray-600">
            為你的團隊量身打造 AI 培訓——客製課綱、彈性時段、實體或線上皆可。
            留下需求，我們將於 1–2 個工作天內與您聯繫。
          </p>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4 py-12">
        <div className="grid gap-4 sm:grid-cols-3">
          {FEATURES.map((f) => (
            <div key={f.title} className="rounded-2xl border border-gray-200 p-6">
              <div className="text-3xl">{f.icon}</div>
              <h2 className="mt-3 font-bold">{f.title}</h2>
              <p className="mt-2 text-sm leading-relaxed text-gray-600">{f.desc}</p>
            </div>
          ))}
        </div>

        <div className="mt-12">
          <h2 className="text-center text-xl font-bold">合作流程</h2>
          <div className="mt-6 grid gap-4 sm:grid-cols-4">
            {STEPS.map((s) => (
              <div key={s.step} className="rounded-2xl bg-gray-50 p-5 text-center">
                <div className="mx-auto flex h-9 w-9 items-center justify-center rounded-full bg-black text-sm font-bold text-white">
                  {s.step}
                </div>
                <div className="mt-3 font-medium">{s.title}</div>
                <p className="mt-1 text-xs text-gray-500">{s.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section id="inquiry" className="mx-auto max-w-2xl px-4 pb-16">
        <div className="rounded-2xl border border-gray-200 p-6 sm:p-8">
          <h2 className="text-xl font-bold">留下您的包班需求</h2>
          <p className="mt-1 mb-6 text-sm text-gray-500">
            帶 <span className="text-red-500">*</span> 為必填；其他欄位可先留空，聯繫時再一起討論。
          </p>
          <CorporateInquiryForm />
        </div>
      </section>
    </div>
  );
}
