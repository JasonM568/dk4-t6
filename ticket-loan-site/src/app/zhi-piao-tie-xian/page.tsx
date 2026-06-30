import type { Metadata } from 'next'
import Link from 'next/link'

export const metadata: Metadata = {
  title: '支票貼現 | 遠期支票快速換現金 | 泰誠企業融資',
  description: '支票貼現服務，持有遠期支票無需等到期日，立即換取現金。費率透明、審核快速、當日可撥款。了解支票貼現條件、費率與申請流程。',
}

const conditions = [
  '公司登記在案之企業或商號',
  '持有未到期之遠期支票（一般為30～180天）',
  '支票發票人具備一定信用條件',
  '票面金額達最低門檻（依實際情況評估）',
]

const features = [
  { icon: '📄', title: '文件簡便', desc: '基本公司文件加支票即可申請，不需繁複資料' },
  { icon: '⚡', title: '快速到帳', desc: '審核通過後最快當日撥款，緊急資金需求也能解決' },
  { icon: '💯', title: '費率透明', desc: '事前清楚說明手續費，無任何隱藏費用' },
  { icon: '🔐', title: '保密處理', desc: '嚴格保護客戶資料，交易完全保密' },
]

const faqs = [
  {
    q: '支票貼現和銀行票貼有什麼差別？',
    a: '銀行票貼審核嚴格、時間較長，通常需要良好信用紀錄且文件繁多。我們的支票貼現服務審核彈性、速度快，更適合急需資金的中小企業。',
  },
  {
    q: '什麼票可以做支票貼現？',
    a: '一般商業支票（含即期及遠期支票）皆可評估。票期通常在30～180天內，超過票期或有退票紀錄的支票可能不符合條件，建議先來電諮詢。',
  },
  {
    q: '支票貼現的費率怎麼計算？',
    a: '費率依票面金額、票期長短、發票人信用狀況等因素綜合評估，一般以月費率方式計算。建議來電或填寫諮詢表格，我們將提供個別報價。',
  },
  {
    q: '支票貼現需要哪些文件？',
    a: '基本需要：公司設立相關文件（公司執照或商業登記）、負責人身分證明、欲貼現之支票。詳細文件清單請洽詢專員確認。',
  },
  {
    q: '遠期支票幾個月都可以貼現嗎？',
    a: '一般接受30～180天的遠期支票，超過180天的長票期支票需個別評估。票期越長，貼現手續費相對較高。',
  },
]

export default function ZhiPiaoTieXianPage() {
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            '@context': 'https://schema.org',
            '@type': 'FAQPage',
            mainEntity: faqs.map((faq) => ({
              '@type': 'Question',
              name: faq.q,
              acceptedAnswer: { '@type': 'Answer', text: faq.a },
            })),
          }),
        }}
      />

      {/* Hero */}
      <section style={{ backgroundColor: '#0D2B5E' }} className="text-white py-16 px-4">
        <div className="max-w-6xl mx-auto">
          <nav className="text-sm text-gray-400 mb-6">
            <Link href="/" className="hover:text-white">首頁</Link>
            <span className="mx-2">/</span>
            <span className="text-white">支票貼現</span>
          </nav>
          <h1 className="text-4xl font-bold mb-4">支票貼現</h1>
          <p className="text-xl text-gray-200 mb-6">遠期支票不必等到期日，立即換現金</p>
          <p className="text-gray-300 leading-relaxed max-w-2xl">
            持有遠期支票的企業，無需等待票期到期，即可透過支票貼現服務提前取得現金，
            有效解決企業資金周轉問題，把握商業機會。
          </p>
        </div>
      </section>

      {/* What is it */}
      <section className="py-16 px-4 bg-gray-50">
        <div className="max-w-6xl mx-auto">
          <div className="grid md:grid-cols-2 gap-12 items-center">
            <div>
              <h2 className="text-2xl font-bold text-[#0D2B5E] mb-6">什麼是支票貼現？</h2>
              <div className="space-y-4 text-gray-600 leading-relaxed">
                <p>
                  <strong className="text-gray-800">支票貼現</strong>（又稱票貼）是一種企業短期融資方式：
                  持票人將尚未到期的遠期支票，以扣除一定手續費後的金額，提前換取現金。
                </p>
                <p>
                  舉例來說，若您持有一張三個月後才到期、面額100萬的支票，
                  透過支票貼現服務，可以不必等待三個月，立即取得約95～98萬的現金
                  （實際金額依手續費計算而定）。
                </p>
                <p>
                  這對於有急迫資金需求的企業而言，是快速、靈活的融資解決方案，
                  廣泛應用於製造業、貿易商、建設公司等各類型企業。
                </p>
              </div>
            </div>
            <div className="bg-white rounded-xl p-8 shadow-sm">
              <h3 className="font-bold text-[#0D2B5E] text-lg mb-6">支票貼現範例試算</h3>
              <div className="space-y-3 text-sm">
                <div className="flex justify-between py-2 border-b border-gray-100">
                  <span className="text-gray-500">支票票面金額</span>
                  <span className="font-bold">$1,000,000</span>
                </div>
                <div className="flex justify-between py-2 border-b border-gray-100">
                  <span className="text-gray-500">票期</span>
                  <span className="font-bold">90 天</span>
                </div>
                <div className="flex justify-between py-2 border-b border-gray-100">
                  <span className="text-gray-500">月費率（示範）</span>
                  <span className="font-bold">1.5%</span>
                </div>
                <div className="flex justify-between py-2 border-b border-gray-100">
                  <span className="text-gray-500">手續費</span>
                  <span className="font-bold text-red-500">- $45,000</span>
                </div>
                <div className="flex justify-between py-3 bg-[#F0F4FF] rounded px-3">
                  <span className="font-bold text-[#0D2B5E]">實際取得現金</span>
                  <span className="font-bold text-[#0D2B5E] text-lg">$955,000</span>
                </div>
              </div>
              <p className="text-xs text-gray-400 mt-4">※ 以上為示範數字，實際費率依評估結果為準</p>
            </div>
          </div>
        </div>
      </section>

      {/* Conditions */}
      <section className="py-16 px-4">
        <div className="max-w-6xl mx-auto">
          <h2 className="text-2xl font-bold text-[#0D2B5E] mb-8 text-center">申請條件</h2>
          <div className="max-w-2xl mx-auto">
            <div className="space-y-3">
              {conditions.map((c) => (
                <div key={c} className="flex items-start gap-3 p-4 bg-gray-50 rounded-lg">
                  <span className="text-green-500 font-bold mt-0.5">✓</span>
                  <span className="text-gray-700">{c}</span>
                </div>
              ))}
            </div>
            <p className="text-sm text-gray-500 mt-6 text-center">
              不確定是否符合條件？歡迎來電免費諮詢，我們提供個別評估服務。
            </p>
          </div>
        </div>
      </section>

      {/* Features */}
      <section className="py-16 px-4 bg-gray-50">
        <div className="max-w-6xl mx-auto">
          <h2 className="text-2xl font-bold text-[#0D2B5E] mb-10 text-center">服務特色</h2>
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-6">
            {features.map((f) => (
              <div key={f.title} className="bg-white rounded-xl p-6 text-center shadow-sm">
                <div className="text-3xl mb-4">{f.icon}</div>
                <h3 className="font-bold text-[#0D2B5E] mb-2">{f.title}</h3>
                <p className="text-gray-500 text-sm">{f.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Process */}
      <section className="py-16 px-4">
        <div className="max-w-4xl mx-auto">
          <h2 className="text-2xl font-bold text-[#0D2B5E] mb-10 text-center">辦理流程</h2>
          <div className="space-y-4">
            {[
              { n: '1', t: '聯繫諮詢', d: '電話或填寫線上表單，說明支票金額與票期，取得初步評估。' },
              { n: '2', t: '準備文件', d: '準備公司登記文件、負責人身分證件及欲貼現的支票。' },
              { n: '3', t: '審核評估', d: '專業人員審核支票及相關文件，提供正式報價與合約條件。' },
              { n: '4', t: '簽約撥款', d: '雙方確認條件後簽署合約，完成後資金快速匯入指定帳戶。' },
            ].map((s) => (
              <div key={s.n} className="flex gap-4 items-start p-6 bg-gray-50 rounded-xl">
                <div
                  className="w-10 h-10 rounded-full flex items-center justify-center text-white font-bold shrink-0"
                  style={{ backgroundColor: '#0D2B5E' }}
                >
                  {s.n}
                </div>
                <div>
                  <h3 className="font-bold text-[#0D2B5E] mb-1">{s.t}</h3>
                  <p className="text-gray-600 text-sm">{s.d}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section className="py-16 px-4 bg-gray-50">
        <div className="max-w-4xl mx-auto">
          <h2 className="text-2xl font-bold text-[#0D2B5E] mb-8 text-center">支票貼現常見問題</h2>
          <div className="space-y-3">
            {faqs.map((faq) => (
              <details key={faq.q} className="group bg-white border border-gray-100 rounded-xl shadow-sm overflow-hidden">
                <summary className="flex items-center justify-between p-6 cursor-pointer font-semibold text-[#0D2B5E] hover:bg-gray-50">
                  {faq.q}
                  <span className="ml-4 text-[#C9922A] group-open:rotate-45 transition-transform shrink-0">+</span>
                </summary>
                <div className="px-6 pb-6 text-gray-600 text-sm leading-relaxed">{faq.a}</div>
              </details>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section style={{ backgroundColor: '#0D2B5E' }} className="py-16 px-4 text-white text-center">
        <div className="max-w-xl mx-auto">
          <h2 className="text-2xl font-bold mb-4">立即諮詢支票貼現服務</h2>
          <p className="text-gray-300 mb-8">免費評估，專業顧問為您說明最適合的方案</p>
          <Link
            href="/contact"
            className="inline-block px-10 py-4 rounded font-bold text-white text-lg transition-opacity hover:opacity-90"
            style={{ backgroundColor: '#C9922A' }}
          >
            免費諮詢
          </Link>
        </div>
      </section>
    </>
  )
}
