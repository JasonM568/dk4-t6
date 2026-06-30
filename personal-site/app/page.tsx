"use client";

import { useState } from "react";

/* ── Navbar ── */
function Navbar() {
  const [open, setOpen] = useState(false);
  const links = [
    { href: "#about", label: "關於我" },
    { href: "#services", label: "服務" },
    { href: "#course", label: "課程" },
    { href: "#testimonials", label: "學員見證" },
    { href: "#contact", label: "聯絡我" },
  ];
  return (
    <nav className="fixed top-0 inset-x-0 z-50 bg-[#FFFBF5]/90 backdrop-blur border-b border-orange-100">
      <div className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between">
        <a href="#" className="font-bold text-xl text-orange-600 tracking-tight">
          陳孟宏
        </a>
        <div className="hidden md:flex items-center gap-6">
          {links.map((l) => (
            <a
              key={l.href}
              href={l.href}
              className="text-sm text-stone-600 hover:text-orange-600 transition-colors"
            >
              {l.label}
            </a>
          ))}
          <a
            href="#contact"
            className="ml-2 bg-orange-500 hover:bg-orange-600 text-white text-sm font-medium px-4 py-2 rounded-full transition-colors"
          >
            預約免費諮詢
          </a>
        </div>
        <button
          className="md:hidden text-stone-700 p-1"
          onClick={() => setOpen(!open)}
          aria-label="開啟選單"
        >
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            {open ? (
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            ) : (
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
            )}
          </svg>
        </button>
      </div>
      {open && (
        <div className="md:hidden bg-[#FFFBF5] border-t border-orange-100 px-6 pb-4">
          {links.map((l) => (
            <a
              key={l.href}
              href={l.href}
              onClick={() => setOpen(false)}
              className="block py-3 text-stone-600 hover:text-orange-600 transition-colors border-b border-orange-50 last:border-0"
            >
              {l.label}
            </a>
          ))}
          <a
            href="#contact"
            onClick={() => setOpen(false)}
            className="mt-3 block text-center bg-orange-500 text-white font-medium py-2.5 rounded-full"
          >
            預約免費諮詢
          </a>
        </div>
      )}
    </nav>
  );
}

/* ── Hero ── */
function Hero() {
  return (
    <section className="pt-32 pb-24 px-6 text-center bg-gradient-to-b from-orange-50 to-[#FFFBF5]">
      <div className="max-w-3xl mx-auto">
        <span className="inline-block bg-orange-100 text-orange-700 text-xs font-semibold px-3 py-1 rounded-full mb-6 animate-fade-in-up">
          AI 導入策略顧問 × Vibe Coding 家教
        </span>
        <h1 className="text-4xl md:text-6xl font-bold text-stone-900 leading-tight mb-6 animate-fade-in-up delay-100">
          讓 AI 真正為你所用，
          <br />
          <span className="text-orange-500">而不只是酷炫的工具</span>
        </h1>
        <p className="text-lg md:text-xl text-stone-500 mb-10 leading-relaxed animate-fade-in-up delay-200">
          我是陳孟宏，協助企業找到最適合自己的 AI 導入方式，讓 AI 真正落地，
          提升效率、優化流程，創造營運價值。
          <br className="hidden md:block" />
          同時教你用 VSCode + Claude Code，不會寫程式也能做出真實作品。
        </p>
        <div className="flex flex-col sm:flex-row gap-4 justify-center animate-fade-in-up delay-300">
          <a
            href="#contact"
            className="bg-orange-500 hover:bg-orange-600 text-white font-semibold px-8 py-4 rounded-full text-lg transition-colors shadow-lg shadow-orange-200"
          >
            預約免費 30 分鐘諮詢
          </a>
          <a
            href="#course"
            className="border-2 border-orange-300 text-orange-700 hover:bg-orange-50 font-semibold px-8 py-4 rounded-full text-lg transition-colors"
          >
            查看課程內容
          </a>
        </div>
        <div className="mt-16 grid grid-cols-3 gap-6 max-w-md mx-auto animate-fade-in-up delay-400">
          {[
            { n: "50+", label: "服務企業" },
            { n: "200+", label: "學員人次" },
            { n: "98%", label: "學員滿意度" },
          ].map((s) => (
            <div key={s.label} className="text-center">
              <div className="text-2xl md:text-3xl font-bold text-orange-500">{s.n}</div>
              <div className="text-xs text-stone-500 mt-1">{s.label}</div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ── About ── */
function About() {
  return (
    <section id="about" className="py-24 px-6">
      <div className="max-w-5xl mx-auto grid md:grid-cols-2 gap-12 items-center">
        <div className="flex justify-center md:justify-end">
          <div className="w-64 h-64 rounded-3xl bg-gradient-to-br from-orange-200 to-orange-400 flex items-center justify-center shadow-xl shadow-orange-100">
            <span className="text-7xl">👨‍💻</span>
          </div>
        </div>
        <div>
          <span className="text-orange-500 font-semibold text-sm uppercase tracking-widest">關於我</span>
          <h2 className="text-3xl md:text-4xl font-bold text-stone-900 mt-2 mb-6">
            讓 AI 從「聽過」到「真的用起來」
          </h2>
          <div className="space-y-4 text-stone-600 leading-relaxed">
            <p>
              我是陳孟宏，一位專注在 AI 落地實務的顧問。這幾年陪伴超過 50 家企業，
              從評估、導入到內部培訓，幫助他們把 AI 從 PowerPoint 上的概念，
              變成真實提升效率的工具。
            </p>
            <p>
              與此同時，我也相信「每個人都應該會用 AI 做出東西」。
              所以我開設 Vibe Coding 家教課，使用 VSCode + Claude Code，
              讓完全沒有程式背景的學員，6 週內做出並部署自己的第一個網站。
            </p>
            <p>
              我相信：最好的學習，是做出一個真實可以給別人看的作品。
            </p>
          </div>
          <div className="mt-8 flex flex-wrap gap-3">
            {["AI 導入策略", "Vibe Coding", "Claude Code", "企業培訓", "Next.js"].map((tag) => (
              <span
                key={tag}
                className="bg-orange-50 border border-orange-200 text-orange-700 text-sm px-3 py-1 rounded-full"
              >
                {tag}
              </span>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

/* ── Services ── */
const services = [
  {
    icon: "🏢",
    title: "企業 AI 導入顧問",
    desc: "從需求評估、工具選型、流程設計到內部培訓，全程陪伴你的團隊把 AI 真正用起來，而不是買了沒人用。",
    cta: "了解企業方案",
    href: "#contact",
    featured: false,
  },
  {
    icon: "🎓",
    title: "Vibe Coding 一對一家教",
    desc: "使用 VSCode + Claude Code，6 週帶你從零做出真實網站並部署上線。不需要程式背景，只需要想做出東西的心。",
    cta: "查看課程",
    href: "#course",
    featured: true,
  },
  {
    icon: "⚡",
    title: "AI 工具諮詢 / 工作坊",
    desc: "半天到一天的工作坊，幫助你的團隊快速上手最新 AI 工具，建立屬於自己的 AI 工作流。",
    cta: "預約工作坊",
    href: "#contact",
    featured: false,
  },
];

function Services() {
  return (
    <section id="services" className="py-24 px-6 bg-orange-50">
      <div className="max-w-5xl mx-auto">
        <div className="text-center mb-14">
          <span className="text-orange-500 font-semibold text-sm uppercase tracking-widest">服務項目</span>
          <h2 className="text-3xl md:text-4xl font-bold text-stone-900 mt-2">我能幫你做什麼</h2>
        </div>
        <div className="grid md:grid-cols-3 gap-6">
          {services.map((s) => (
            <div
              key={s.title}
              className={`rounded-2xl p-8 flex flex-col ${
                s.featured
                  ? "bg-orange-500 text-white shadow-xl shadow-orange-200"
                  : "bg-white text-stone-800 shadow-sm border border-orange-100"
              }`}
            >
              <div className="text-4xl mb-4">{s.icon}</div>
              <h3 className={`text-xl font-bold mb-3 ${s.featured ? "text-white" : "text-stone-900"}`}>
                {s.title}
              </h3>
              <p className={`text-sm leading-relaxed flex-1 ${s.featured ? "text-orange-100" : "text-stone-500"}`}>
                {s.desc}
              </p>
              <a
                href={s.href}
                className={`mt-6 inline-block text-sm font-semibold px-5 py-2.5 rounded-full text-center transition-colors ${
                  s.featured
                    ? "bg-white text-orange-600 hover:bg-orange-50"
                    : "border-2 border-orange-300 text-orange-600 hover:bg-orange-50"
                }`}
              >
                {s.cta} →
              </a>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ── Course ── */
const weeks = [
  { week: "第 1 週", title: "心態建立 + 環境設定", desc: "安裝 VSCode & Claude Code，理解 Vibe Coding 核心思維，完成第一個 Hello World。" },
  { week: "第 2 週", title: "學會寫好 Prompt", desc: "Prompt 結構公式、Context 管理、用 CLAUDE.md 讓 AI 記住你的專案規則。" },
  { week: "第 3 週", title: "第一個真實專案", desc: "建立個人連結頁，推到 GitHub，部署到 Vercel，你的第一個網站上線！" },
  { week: "第 4 週", title: "互動功能 + API", desc: "加入聯絡表單、串接天氣或新聞 API，讓網站有真實的互動能力。" },
  { week: "第 5 週", title: "完整 App 開發", desc: "從需求拆解到功能實作，做出 Todo App，學習完整除錯流程。" },
  { week: "第 6 週", title: "進階技巧 + 結業展示", desc: "Claude Code 進階功能、建立 prompt 模板庫，成果展示！" },
];

function Course() {
  return (
    <section id="course" className="py-24 px-6">
      <div className="max-w-5xl mx-auto">
        <div className="text-center mb-14">
          <span className="text-orange-500 font-semibold text-sm uppercase tracking-widest">課程介紹</span>
          <h2 className="text-3xl md:text-4xl font-bold text-stone-900 mt-2">
            Vibe Coding 新手入門課
          </h2>
          <p className="text-stone-500 mt-4 max-w-xl mx-auto">
            6 週 × 每週 3 小時，共 18 小時。不需要程式背景，每週都有可以展示的成果。
            使用 VSCode + Claude Code，與業界同步。
          </p>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-12">
          {[
            { icon: "🕐", label: "總時數", value: "18 小時" },
            { icon: "📅", label: "課程週期", value: "6 週" },
            { icon: "👥", label: "上課形式", value: "一對一" },
            { icon: "🚀", label: "結業成果", value: "真實上線網站" },
          ].map((stat) => (
            <div key={stat.label} className="bg-orange-50 rounded-2xl p-5 text-center border border-orange-100">
              <div className="text-2xl mb-2">{stat.icon}</div>
              <div className="font-bold text-stone-900">{stat.value}</div>
              <div className="text-xs text-stone-500 mt-0.5">{stat.label}</div>
            </div>
          ))}
        </div>

        <div className="grid md:grid-cols-2 gap-4">
          {weeks.map((w, i) => (
            <div key={i} className="flex gap-4 bg-white border border-orange-100 rounded-2xl p-6 shadow-sm">
              <div className="shrink-0 w-10 h-10 rounded-full bg-orange-100 text-orange-600 flex items-center justify-center font-bold text-sm">
                {i + 1}
              </div>
              <div>
                <div className="text-xs text-orange-500 font-semibold mb-0.5">{w.week}</div>
                <div className="font-bold text-stone-900 mb-1">{w.title}</div>
                <div className="text-sm text-stone-500">{w.desc}</div>
              </div>
            </div>
          ))}
        </div>

        <div className="mt-10 text-center">
          <a
            href="#contact"
            className="inline-block bg-orange-500 hover:bg-orange-600 text-white font-semibold px-8 py-4 rounded-full text-lg transition-colors shadow-lg shadow-orange-100"
          >
            預約試上一堂課 →
          </a>
          <p className="text-sm text-stone-400 mt-3">首堂課免費體驗，沒有壓力</p>
        </div>
      </div>
    </section>
  );
}

/* ── Testimonials ── */
const testimonials = [
  {
    name: "林小姐",
    role: "電商創業者",
    avatar: "🧕",
    content:
      "完全沒有程式背景，第 3 週就把自己的品牌官網部署上線了。孟宏老師解釋得非常清楚，每次卡關都能快速幫我找到原因。",
  },
  {
    name: "王先生",
    role: "中小企業主",
    avatar: "👨‍💼",
    content:
      "原本以為 AI 導入很複雜，孟宏幫我們梳理流程之後，兩個月內就讓客服效率提升了 40%。真的是把抽象概念變成實際成果。",
  },
  {
    name: "張同學",
    role: "大學生 / 自學者",
    avatar: "🧑‍🎓",
    content:
      "課程很有系統，每週都有東西可以展示給朋友看。老師不只教工具，還幫你建立思考框架，這個最值錢。",
  },
  {
    name: "陳經理",
    role: "行銷部門主管",
    avatar: "👩‍💼",
    content:
      "工作坊結束後整個團隊都開始用 Claude 處理日常文案和報告，省下大量時間。強烈推薦給想提升團隊 AI 素養的主管。",
  },
];

function Testimonials() {
  return (
    <section id="testimonials" className="py-24 px-6 bg-stone-50">
      <div className="max-w-5xl mx-auto">
        <div className="text-center mb-14">
          <span className="text-orange-500 font-semibold text-sm uppercase tracking-widest">學員見證</span>
          <h2 className="text-3xl md:text-4xl font-bold text-stone-900 mt-2">真實學員的回饋</h2>
        </div>
        <div className="grid md:grid-cols-2 gap-6">
          {testimonials.map((t) => (
            <div key={t.name} className="bg-white rounded-2xl p-7 shadow-sm border border-stone-100">
              <div className="flex gap-0.5 mb-4">
                {Array.from({ length: 5 }).map((_, i) => (
                  <span key={i} className="text-orange-400 text-lg">★</span>
                ))}
              </div>
              <p className="text-stone-600 leading-relaxed mb-6">"{t.content}"</p>
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-orange-100 flex items-center justify-center text-xl">
                  {t.avatar}
                </div>
                <div>
                  <div className="font-semibold text-stone-900 text-sm">{t.name}</div>
                  <div className="text-xs text-stone-400">{t.role}</div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ── Contact ── */
function Contact() {
  const [status, setStatus] = useState<"idle" | "sending" | "done" | "error">("idle");

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setStatus("sending");
    const form = e.currentTarget;
    const data = new FormData(form);
    try {
      const res = await fetch("https://formspree.io/f/YOUR_FORM_ID", {
        method: "POST",
        body: data,
        headers: { Accept: "application/json" },
      });
      if (res.ok) {
        setStatus("done");
        form.reset();
      } else {
        setStatus("error");
      }
    } catch {
      setStatus("error");
    }
  }

  return (
    <section id="contact" className="py-24 px-6 bg-gradient-to-b from-[#FFFBF5] to-orange-50">
      <div className="max-w-2xl mx-auto">
        <div className="text-center mb-12">
          <span className="text-orange-500 font-semibold text-sm uppercase tracking-widest">聯絡我</span>
          <h2 className="text-3xl md:text-4xl font-bold text-stone-900 mt-2">預約免費 30 分鐘諮詢</h2>
          <p className="text-stone-500 mt-4">
            不管是企業 AI 導入、課程詢問，或是單純想聊聊，都歡迎填表。
            我通常在 24 小時內回覆。
          </p>
        </div>

        <div className="bg-white rounded-3xl shadow-sm border border-orange-100 p-8 md:p-10">
          {status === "done" ? (
            <div className="text-center py-10">
              <div className="text-5xl mb-4">🎉</div>
              <h3 className="text-xl font-bold text-stone-900 mb-2">已收到你的訊息！</h3>
              <p className="text-stone-500">我會在 24 小時內回覆你，期待和你聊聊！</p>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-5">
              <div className="grid sm:grid-cols-2 gap-5">
                <div>
                  <label className="block text-sm font-medium text-stone-700 mb-1.5">姓名 *</label>
                  <input
                    name="name"
                    required
                    placeholder="你的稱呼"
                    className="w-full border border-stone-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-orange-300 bg-[#FFFBF5]"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-stone-700 mb-1.5">Email *</label>
                  <input
                    name="email"
                    type="email"
                    required
                    placeholder="your@email.com"
                    className="w-full border border-stone-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-orange-300 bg-[#FFFBF5]"
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-stone-700 mb-1.5">我想了解</label>
                <select
                  name="interest"
                  className="w-full border border-stone-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-orange-300 bg-[#FFFBF5] text-stone-700"
                >
                  <option value="">請選擇</option>
                  <option value="course">Vibe Coding 一對一家教課程</option>
                  <option value="enterprise">企業 AI 導入顧問</option>
                  <option value="workshop">AI 工作坊</option>
                  <option value="other">其他</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-stone-700 mb-1.5">想說的話</label>
                <textarea
                  name="message"
                  rows={4}
                  placeholder="簡單介紹你的情況或需求，讓我更了解你..."
                  className="w-full border border-stone-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-orange-300 bg-[#FFFBF5] resize-none"
                />
              </div>

              {status === "error" && (
                <p className="text-red-500 text-sm">傳送失敗，請直接寄信給我。</p>
              )}

              <button
                type="submit"
                disabled={status === "sending"}
                className="w-full bg-orange-500 hover:bg-orange-600 disabled:bg-orange-300 text-white font-semibold py-4 rounded-xl transition-colors text-base"
              >
                {status === "sending" ? "傳送中..." : "送出 →"}
              </button>
              <p className="text-center text-xs text-stone-400">不會有任何垃圾信，只有真誠的回覆。</p>
            </form>
          )}
        </div>
      </div>
    </section>
  );
}

/* ── Footer ── */
function Footer() {
  return (
    <footer className="bg-stone-900 text-stone-400 py-10 px-6">
      <div className="max-w-5xl mx-auto flex flex-col md:flex-row items-center justify-between gap-4">
        <div>
          <div className="font-bold text-white text-lg">陳孟宏</div>
          <div className="text-sm mt-0.5">AI 導入策略顧問 × Vibe Coding 家教</div>
        </div>
        <div className="text-sm">© 2026 陳孟宏. All rights reserved.</div>
      </div>
    </footer>
  );
}

/* ── Main Page ── */
export default function HomePage() {
  return (
    <>
      <Navbar />
      <main>
        <Hero />
        <About />
        <Services />
        <Course />
        <Testimonials />
        <Contact />
      </main>
      <Footer />
    </>
  );
}
