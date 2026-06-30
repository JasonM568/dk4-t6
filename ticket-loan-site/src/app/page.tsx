import type { Metadata } from 'next'
import Link from 'next/link'

export const metadata: Metadata = {
  title: '支票貸款・支票貼現 | 企業資金周轉首選 | 泰誠企業融資',
  description: '支票貼現、支票貸款專業服務。遠期支票快速換現金，最快24小時內審核撥款。中小企業資金周轉首選，安全合法，費率透明。立即免費諮詢。',
}

const stats = [
  { value: '10+', label: '年服務經驗' },
  { value: '1,000+', label: '服務企業數' },
  { value: '24H', label: '快速審核' },
  { value: '98%', label: '客戶滿意度' },
]

const services = [
  {
    title: '支票貼現',
    subtitle: '遠期支票立即換現金',
    desc: '持有遠期支票無需等到到期日，立即換取現金解決資金需求。手續簡便，費率透明。',
    features: ['各類支票均可申請', '當日審核、快速到帳', '費率依票期與金額計算', '文件簡單，流程快速'],
    href: '/zhi-piao-tie-xian',
    color: '#0D2B5E',
  },
  {
    title: '支票貸款',
    subtitle: '以支票作為擔保融資',
    desc: '以企業持有的支票作為擔保，取得所需資金。彈性還款方式，協助企業度過資金瓶頸。',
    features: ['支票擔保，額度較高', '彈性還款，資金靈活', '不影響企業信用紀錄', '保密處理，安心放心'],
    href: '/zhi-piao-dai-kuan',
    color: '#1B5E20',
  },
]

const whyUs = [
  {
    icon: '⚡',
    title: '快速到位',
    desc: '審核流程精簡，最快當日完成撥款，緊急資金需求也能迅速解決。',
  },
  {
    icon: '🔒',
    title: '安全合法',
    desc: '依法合規經營，完整保障客戶權益，所有交易均有白紙黑字合約保障。',
  },
  {
    icon: '💰',
    title: '費率透明',
    desc: '事前清楚說明所有費用，無隱藏收費，讓您安心借貸、明白還款。',
  },
  {
    icon: '🤝',
    title: '專業服務',
    desc: '10年以上融資經驗，專業顧問一對一服務，提供最適合的融資方案。',
  },
]

const steps = [
  { step: '01', title: '免費諮詢', desc: '電話或線上諮詢，說明需求，初步評估可行方案。' },
  { step: '02', title: '提供文件', desc: '準備支票、公司基本文件，流程簡便快速。' },
  { step: '03', title: '快速審核', desc: '專業人員審核，最快24小時內完成評估。' },
  { step: '04', title: '簽約撥款', desc: '確認條件後簽署合約，資金快速到位。' },
]

const faqs = [
  {
    q: '什麼是支票貼現？',
    a: '支票貼現是指持票人將未到期的支票，以一定的折扣提前兌換成現金的融資方式。企業可以不必等到支票到期日，即可取得所需資金。',
  },
  {
    q: '支票貼現合法嗎？',
    a: '合法。支票貼現是正規的商業融資行為，我們依法合規經營，所有交易均有正式合約保障，與非法地下錢莊完全不同。',
  },
  {
    q: '申請支票貸款需要什麼條件？',
    a: '基本條件包括：持有有效支票、企業設立登記、票面金額達一定門檻。具體條件請來電諮詢，我們提供免費評估服務。',
  },
  {
    q: '多久可以拿到資金？',
    a: '一般審核流程約需1～3個工作天，緊急案件可申請加急處理，最快當日完成審核並撥款。',
  },
]

export default function HomePage() {
  return (
    <>
      {/* JSON-LD 結構化資料 */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            '@context': 'https://schema.org',
            '@type': 'FinancialService',
            name: '泰誠企業融資',
            description: '支票貼現、支票貸款專業服務，協助中小企業解決資金周轉問題',
            url: 'https://example.com',
            telephone: '02-XXXX-XXXX',
            address: {
              '@type': 'PostalAddress',
              addressLocality: '台北市',
              addressCountry: 'TW',
            },
            openingHours: 'Mo-Fr 09:00-18:00',
            serviceType: ['支票貼現', '支票貸款', '企業融資'],
          }),
        }}
      />

      {/* Hero */}
      <section style={{ background: 'linear-gradient(135deg, #0D2B5E 0%, #1a4080 100%)' }} className="text-white py-20 px-4">
        <div className="max-w-6xl mx-auto">
          <div className="max-w-2xl">
            <p className="text-[#C9922A] font-semibold text-sm mb-3 tracking-widest uppercase">企業資金周轉解決方案</p>
            <h1 className="text-4xl md:text-5xl font-bold leading-tight mb-6">
              支票快速換現金<br />
              <span style={{ color: '#F5C842' }}>最快當日撥款</span>
            </h1>
            <p className="text-gray-200 text-lg mb-8 leading-relaxed">
              專業支票貼現、支票貸款服務<br />
              協助中小企業迅速解決資金周轉困難
            </p>
            <div className="flex flex-col sm:flex-row gap-4">
              <Link
                href="/contact"
                className="inline-block text-center px-8 py-4 rounded font-bold text-white text-lg transition-opacity hover:opacity-90"
                style={{ backgroundColor: '#C9922A' }}
              >
                立即免費諮詢
              </Link>
              <Link
                href="/zhi-piao-tie-xian"
                className="inline-block text-center px-8 py-4 rounded font-bold text-white text-lg border border-white/40 hover:bg-white/10 transition-colors"
              >
                了解支票貼現
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* Stats */}
      <section className="bg-[#C9922A] py-8 px-4">
        <div className="max-w-6xl mx-auto grid grid-cols-2 md:grid-cols-4 gap-6 text-white text-center">
          {stats.map((s) => (
            <div key={s.label}>
              <div className="text-3xl font-bold">{s.value}</div>
              <div className="text-sm opacity-90 mt-1">{s.label}</div>
            </div>
          ))}
        </div>
      </section>

      {/* Services */}
      <section className="py-16 px-4 bg-gray-50">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-12">
            <h2 className="text-3xl font-bold text-[#0D2B5E] mb-3">我們的服務</h2>
            <p className="text-gray-500">提供完整的支票融資解決方案</p>
          </div>
          <div className="grid md:grid-cols-2 gap-8">
            {services.map((svc) => (
              <div key={svc.title} className="bg-white rounded-xl shadow-sm p-8 hover:shadow-md transition-shadow">
                <div className="w-12 h-1 rounded mb-4" style={{ backgroundColor: svc.color }} />
                <h3 className="text-2xl font-bold mb-1" style={{ color: svc.color }}>{svc.title}</h3>
                <p className="text-[#C9922A] font-medium text-sm mb-4">{svc.subtitle}</p>
                <p className="text-gray-600 mb-6 leading-relaxed">{svc.desc}</p>
                <ul className="space-y-2 mb-8">
                  {svc.features.map((f) => (
                    <li key={f} className="flex items-center gap-2 text-sm text-gray-600">
                      <span className="text-green-500 font-bold">✓</span> {f}
                    </li>
                  ))}
                </ul>
                <Link
                  href={svc.href}
                  className="inline-block px-6 py-3 rounded font-bold text-white text-sm transition-opacity hover:opacity-90"
                  style={{ backgroundColor: svc.color }}
                >
                  了解更多 →
                </Link>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Why Us */}
      <section className="py-16 px-4">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-12">
            <h2 className="text-3xl font-bold text-[#0D2B5E] mb-3">為什麼選擇我們</h2>
            <p className="text-gray-500">10年融資經驗，值得信賴的企業夥伴</p>
          </div>
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-6">
            {whyUs.map((item) => (
              <div key={item.title} className="text-center p-6">
                <div className="text-4xl mb-4">{item.icon}</div>
                <h3 className="font-bold text-[#0D2B5E] text-lg mb-2">{item.title}</h3>
                <p className="text-gray-500 text-sm leading-relaxed">{item.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Process */}
      <section className="py-16 px-4" style={{ backgroundColor: '#F0F4FF' }}>
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-12">
            <h2 className="text-3xl font-bold text-[#0D2B5E] mb-3">辦理流程</h2>
            <p className="text-gray-500">簡單 4 步驟，快速取得資金</p>
          </div>
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-6">
            {steps.map((s, i) => (
              <div key={s.step} className="relative">
                {i < steps.length - 1 && (
                  <div className="hidden lg:block absolute top-6 left-full w-full h-0.5 bg-gray-200 z-0" style={{ width: 'calc(100% - 48px)', left: '48px' }} />
                )}
                <div className="relative z-10 bg-white rounded-xl p-6 text-center shadow-sm">
                  <div
                    className="w-12 h-12 rounded-full flex items-center justify-center text-white font-bold text-lg mx-auto mb-4"
                    style={{ backgroundColor: '#0D2B5E' }}
                  >
                    {s.step}
                  </div>
                  <h3 className="font-bold text-[#0D2B5E] mb-2">{s.title}</h3>
                  <p className="text-gray-500 text-sm">{s.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* FAQ Preview */}
      <section className="py-16 px-4">
        <div className="max-w-4xl mx-auto">
          <div className="text-center mb-12">
            <h2 className="text-3xl font-bold text-[#0D2B5E] mb-3">常見問題</h2>
            <p className="text-gray-500">快速解答您的疑問</p>
          </div>
          <div className="space-y-4">
            {faqs.map((faq) => (
              <details key={faq.q} className="group bg-white border border-gray-100 rounded-xl shadow-sm overflow-hidden">
                <summary className="flex items-center justify-between p-6 cursor-pointer font-semibold text-[#0D2B5E] hover:bg-gray-50">
                  {faq.q}
                  <span className="ml-4 text-[#C9922A] group-open:rotate-45 transition-transform">+</span>
                </summary>
                <div className="px-6 pb-6 text-gray-600 leading-relaxed text-sm">{faq.a}</div>
              </details>
            ))}
          </div>
          <div className="text-center mt-8">
            <Link href="/faq" className="text-[#0D2B5E] font-semibold hover:underline">
              查看所有常見問題 →
            </Link>
          </div>
        </div>
      </section>

      {/* CTA Banner */}
      <section style={{ backgroundColor: '#0D2B5E' }} className="py-16 px-4 text-white text-center">
        <div className="max-w-2xl mx-auto">
          <h2 className="text-3xl font-bold mb-4">立即解決企業資金問題</h2>
          <p className="text-gray-300 mb-8">免費評估，不收諮詢費，專業顧問為您量身規劃融資方案</p>
          <Link
            href="/contact"
            className="inline-block px-10 py-4 rounded font-bold text-white text-lg transition-opacity hover:opacity-90"
            style={{ backgroundColor: '#C9922A' }}
          >
            免費諮詢 / 立即申請
          </Link>
        </div>
      </section>
    </>
  )
}
