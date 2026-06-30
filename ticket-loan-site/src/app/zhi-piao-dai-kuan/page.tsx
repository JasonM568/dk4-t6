import type { Metadata } from 'next'
import Link from 'next/link'

export const metadata: Metadata = {
  title: '支票貸款 | 支票擔保企業融資 | 泰誠企業融資',
  description: '支票貸款服務，以企業持有支票作為擔保，取得所需資金。額度彈性、審核快速。了解支票貸款條件、流程，立即免費諮詢。',
}

const compareItems = [
  { item: '適用對象', ticketLoan: '需要較大額度融資', ticketDiscount: '急需票面金額現金' },
  { item: '資金來源', ticketLoan: '以支票擔保借款', ticketDiscount: '支票票面金額折現' },
  { item: '可借金額', ticketLoan: '可高於票面金額', ticketDiscount: '約票面金額85-98%' },
  { item: '還款方式', ticketLoan: '彈性分期還款', ticketDiscount: '票期到期一次清償' },
  { item: '適合情境', ticketLoan: '需要更高資金靈活度', ticketDiscount: '單純換取票面現金' },
]

const faqs = [
  {
    q: '支票貸款和支票貼現有什麼差別？',
    a: '支票貸款是以支票作為擔保品向我們借款，可借金額有時可高於票面金額，並有彈性的還款方式。支票貼現則是直接以較低價格將支票兌現，取得金額即為扣除手續費後的票面金額。',
  },
  {
    q: '支票貸款的利率是多少？',
    a: '利率依借款金額、還款期限、擔保品品質等因素綜合評估。我們堅持費率透明，於辦理前清楚說明所有費用，歡迎來電取得個別報價。',
  },
  {
    q: '支票貸款需要額外擔保品嗎？',
    a: '以支票為主要擔保，部分情況下可能需要輔助擔保條件，視個別案件狀況而定。詳情請來電洽詢專員評估。',
  },
  {
    q: '支票貸款最多可以借多少錢？',
    a: '貸款額度依擔保支票金額、企業信用狀況及還款能力綜合評估，無固定上限。請來電告知需求，我們將提供最大化的融資方案。',
  },
]

export default function ZhiPiaoDaiKuanPage() {
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
      <section style={{ backgroundColor: '#1B5E20' }} className="text-white py-16 px-4">
        <div className="max-w-6xl mx-auto">
          <nav className="text-sm text-gray-300 mb-6">
            <Link href="/" className="hover:text-white">首頁</Link>
            <span className="mx-2">/</span>
            <span className="text-white">支票貸款</span>
          </nav>
          <h1 className="text-4xl font-bold mb-4">支票貸款</h1>
          <p className="text-xl text-green-100 mb-6">以支票擔保，取得更高額度的企業融資</p>
          <p className="text-green-100 leading-relaxed max-w-2xl">
            不同於支票貼現，支票貸款以您持有的支票作為擔保品，取得所需資金，
            提供更彈性的還款方式，協助企業進行更長期的資金規劃。
          </p>
        </div>
      </section>

      {/* What is it */}
      <section className="py-16 px-4 bg-gray-50">
        <div className="max-w-6xl mx-auto">
          <div className="grid md:grid-cols-2 gap-12 items-start">
            <div>
              <h2 className="text-2xl font-bold text-[#0D2B5E] mb-6">什麼是支票貸款？</h2>
              <div className="space-y-4 text-gray-600 leading-relaxed">
                <p>
                  <strong className="text-gray-800">支票貸款</strong>是以企業持有的支票作為擔保品，
                  向融資機構借款的融資方式。與支票貼現不同，支票貸款的借款金額可以超過票面金額，
                  並提供分期還款的彈性。
                </p>
                <p>
                  適合需要較大資金或希望保留更多現金流彈性的企業。當您需要的資金超過現有支票票面金額，
                  或希望以分期方式還款，支票貸款是更合適的選擇。
                </p>
                <p>
                  透過支票貸款，企業可以在不出售支票的情況下，以支票的信用基礎取得資金，
                  對企業的財務彈性有更大的幫助。
                </p>
              </div>
            </div>
            <div>
              <h3 className="font-bold text-[#0D2B5E] text-lg mb-4">支票貸款適合您嗎？</h3>
              <div className="space-y-3">
                {[
                  '需要資金超過現有支票票面金額',
                  '希望以分期方式還款，減輕一次性壓力',
                  '需要保留支票以備其他用途',
                  '企業有穩定還款能力但需要短期資金',
                  '進行設備採購、原料備貨等營運投資',
                ].map((item) => (
                  <div key={item} className="flex items-start gap-3 p-3 bg-green-50 rounded-lg">
                    <span className="text-green-600 font-bold mt-0.5">✓</span>
                    <span className="text-gray-700 text-sm">{item}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Compare */}
      <section className="py-16 px-4">
        <div className="max-w-4xl mx-auto">
          <h2 className="text-2xl font-bold text-[#0D2B5E] mb-8 text-center">支票貸款 vs 支票貼現 比較</h2>
          <div className="overflow-x-auto rounded-xl shadow-sm">
            <table className="w-full text-sm">
              <thead>
                <tr style={{ backgroundColor: '#0D2B5E' }} className="text-white">
                  <th className="p-4 text-left">比較項目</th>
                  <th className="p-4 text-center">支票貸款</th>
                  <th className="p-4 text-center">支票貼現</th>
                </tr>
              </thead>
              <tbody>
                {compareItems.map((row, i) => (
                  <tr key={row.item} className={i % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                    <td className="p-4 font-medium text-gray-700">{row.item}</td>
                    <td className="p-4 text-center text-gray-600">{row.ticketLoan}</td>
                    <td className="p-4 text-center text-gray-600">{row.ticketDiscount}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-center text-sm text-gray-500 mt-6">
            不確定哪種方案最適合？
            <Link href="/contact" className="text-[#0D2B5E] font-semibold ml-1 hover:underline">
              免費諮詢專員為您分析
            </Link>
          </p>
        </div>
      </section>

      {/* Process */}
      <section className="py-16 px-4 bg-gray-50">
        <div className="max-w-4xl mx-auto">
          <h2 className="text-2xl font-bold text-[#0D2B5E] mb-10 text-center">申請流程</h2>
          <div className="space-y-4">
            {[
              { n: '1', t: '初步諮詢', d: '說明資金需求及持有支票情況，取得初步融資評估。' },
              { n: '2', t: '文件準備', d: '公司登記文件、財務相關資料、擔保支票等基本文件。' },
              { n: '3', t: '信用評估', d: '評估企業信用狀況與還款能力，確定貸款額度與條件。' },
              { n: '4', t: '簽約動撥', d: '雙方確認貸款條件後簽署合約，資金撥入指定帳戶。' },
            ].map((s) => (
              <div key={s.n} className="flex gap-4 items-start p-6 bg-white rounded-xl shadow-sm">
                <div
                  className="w-10 h-10 rounded-full flex items-center justify-center text-white font-bold shrink-0"
                  style={{ backgroundColor: '#1B5E20' }}
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
      <section className="py-16 px-4">
        <div className="max-w-4xl mx-auto">
          <h2 className="text-2xl font-bold text-[#0D2B5E] mb-8 text-center">支票貸款常見問題</h2>
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
          <h2 className="text-2xl font-bold mb-4">了解支票貸款方案</h2>
          <p className="text-gray-300 mb-8">專業顧問分析最適合您企業的融資策略</p>
          <Link
            href="/contact"
            className="inline-block px-10 py-4 rounded font-bold text-white text-lg transition-opacity hover:opacity-90"
            style={{ backgroundColor: '#C9922A' }}
          >
            立即免費諮詢
          </Link>
        </div>
      </section>
    </>
  )
}
