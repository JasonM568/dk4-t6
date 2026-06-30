import type { Metadata } from 'next'
import Link from 'next/link'

export const metadata: Metadata = {
  title: '常見問題 FAQ | 支票貼現・支票貸款 | 泰誠企業融資',
  description: '支票貼現和支票貸款的常見問題整理。包含費率計算、申請條件、辦理流程、合法性說明等。解答您對企業融資的所有疑問。',
}

const faqCategories = [
  {
    category: '關於支票貼現',
    faqs: [
      {
        q: '什麼是支票貼現？',
        a: '支票貼現（票貼）是指持票人將未到期的遠期支票，以扣除手續費後的金額提前換取現金的融資方式。企業不必等到支票到期，即可取得所需資金，有效解決資金周轉問題。',
      },
      {
        q: '支票貼現合法嗎？',
        a: '支票貼現是正規合法的商業融資行為，泰誠企業融資依法合規經營，所有交易均簽署正式合約、明列費率，受法律保障。與非法地下錢莊的差別在於：我們的費率透明、有合法執照、交易有憑有據。',
      },
      {
        q: '支票貼現跟銀行票貼有什麼不同？',
        a: '銀行票貼審核嚴格，需要良好信用記錄、企業財務報表，且流程通常需要1~2週。我們的支票貼現服務審核較彈性、速度快（最快當日），更適合急需資金或不符合銀行條件的中小企業。',
      },
      {
        q: '什麼票可以做支票貼現？',
        a: '一般商業支票（即期及遠期）均可評估，票期通常在30～180天內。以下情況可能不符合：已有退票紀錄的支票、票期超過180天的長期票、無效票或問題票。建議先來電諮詢，我們提供免費初步評估。',
      },
      {
        q: '支票貼現的費率怎麼算？',
        a: '費率依票面金額、票期長短、發票人信用狀況等因素綜合計算，一般以月費率計算。舉例：100萬票面金額、3個月票期、月費率1.5%，手續費約為45,000元，實拿約955,000元。實際費率請來電取得個別報價。',
      },
      {
        q: '支票貼現需要哪些文件？',
        a: '基本文件包括：(1) 公司設立相關文件（公司登記證或商業登記抄本）；(2) 負責人身分證正本；(3) 欲貼現的支票正本；(4) 部分情況下可能需要公司大小章。詳細文件清單請洽詢專員。',
      },
      {
        q: '遠期支票幾個月都可以貼現嗎？',
        a: '一般接受30～180天的遠期支票，超過180天的長票期需個別評估。票期越長，相對手續費也會較高。建議若有超過6個月的長票，先來電諮詢可行性。',
      },
      {
        q: '多久可以拿到錢？',
        a: '一般審核流程約需1～2個工作天，資料齊全的情況下最快當日可完成並撥款。若有緊急需求，可告知專員申請加急處理。',
      },
    ],
  },
  {
    category: '關於支票貸款',
    faqs: [
      {
        q: '支票貸款和支票貼現有什麼差別？',
        a: '支票貸款是以支票作為擔保品「借款」，可借金額可高於票面金額，並提供分期還款彈性；支票貼現是直接將支票「兌現」，取得扣除手續費後的票面金額。選擇哪種方案取決於您的資金需求與還款規劃。',
      },
      {
        q: '支票貸款額度最高可以借多少？',
        a: '貸款額度依擔保支票金額、企業信用狀況及還款能力綜合評估，無統一上限。請來電說明需求，我們將評估最高可提供的融資額度。',
      },
      {
        q: '支票貸款需要額外擔保嗎？',
        a: '以支票為主要擔保品。部分高額案件或信用條件較特殊的情況，可能需要輔助擔保條件（如不動產抵押或保證人）。詳情依個案評估。',
      },
      {
        q: '支票貸款的還款方式有哪些？',
        a: '我們提供彈性還款方案，包括：等額本息分期還款、到期一次清償、或依照企業現金流量客製化還款計畫。具體方案於洽談時依需求規劃。',
      },
    ],
  },
  {
    category: '服務相關',
    faqs: [
      {
        q: '申請前需要收諮詢費嗎？',
        a: '不需要。我們提供完全免費的初步諮詢與評估服務，只有在雙方確認合作並簽署合約後，才會收取相關費用。',
      },
      {
        q: '我的資料會保密嗎？',
        a: '是的，我們嚴格保護所有客戶資料，不會對外洩漏任何個人或企業資訊。所有文件依法妥善保管，服務結束後依規定銷毀。',
      },
      {
        q: '可以在非工作時間諮詢嗎？',
        a: '正常服務時間為週一至週五 09:00～18:00。緊急案件可撥打專線，我們將盡力安排。',
      },
      {
        q: '支票被退票過可以申請嗎？',
        a: '持有人（貴公司）有退票紀錄不一定影響申請，重要的是擔保支票本身的品質與發票人信用狀況。建議先來電諮詢，由專員評估您的具體情況。',
      },
    ],
  },
]

export default function FaqPage() {
  const allFaqs = faqCategories.flatMap((cat) =>
    cat.faqs.map((faq) => ({ ...faq, category: cat.category }))
  )

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            '@context': 'https://schema.org',
            '@type': 'FAQPage',
            mainEntity: allFaqs.map((faq) => ({
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
            <span className="text-white">常見問題</span>
          </nav>
          <h1 className="text-4xl font-bold mb-4">常見問題 FAQ</h1>
          <p className="text-gray-300 text-lg">
            關於支票貼現、支票貸款您最想知道的問題，我們一次解答
          </p>
        </div>
      </section>

      {/* FAQ Sections */}
      <section className="py-16 px-4">
        <div className="max-w-4xl mx-auto space-y-12">
          {faqCategories.map((cat) => (
            <div key={cat.category}>
              <h2 className="text-xl font-bold text-[#0D2B5E] mb-6 pb-2 border-b-2 border-[#C9922A]">
                {cat.category}
              </h2>
              <div className="space-y-3">
                {cat.faqs.map((faq) => (
                  <details key={faq.q} className="group bg-white border border-gray-100 rounded-xl shadow-sm overflow-hidden">
                    <summary className="flex items-center justify-between p-6 cursor-pointer font-semibold text-[#0D2B5E] hover:bg-gray-50">
                      {faq.q}
                      <span className="ml-4 text-[#C9922A] group-open:rotate-45 transition-transform shrink-0 text-xl">+</span>
                    </summary>
                    <div className="px-6 pb-6 text-gray-600 text-sm leading-relaxed">{faq.a}</div>
                  </details>
                ))}
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Still have questions */}
      <section className="py-16 px-4 bg-gray-50">
        <div className="max-w-2xl mx-auto text-center">
          <h2 className="text-2xl font-bold text-[#0D2B5E] mb-4">還有其他問題？</h2>
          <p className="text-gray-600 mb-8">
            歡迎直接聯繫我們，專業顧問將為您提供一對一的免費諮詢服務
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <Link
              href="/contact"
              className="inline-block px-8 py-3 rounded font-bold text-white transition-opacity hover:opacity-90"
              style={{ backgroundColor: '#C9922A' }}
            >
              填寫諮詢表單
            </Link>
            <a
              href="tel:02-XXXX-XXXX"
              className="inline-block px-8 py-3 rounded font-bold border-2 transition-colors hover:bg-gray-100"
              style={{ borderColor: '#0D2B5E', color: '#0D2B5E' }}
            >
              📞 直接來電諮詢
            </a>
          </div>
        </div>
      </section>
    </>
  )
}
