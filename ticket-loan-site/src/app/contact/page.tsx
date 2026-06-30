import type { Metadata } from 'next'
import Link from 'next/link'

export const metadata: Metadata = {
  title: '聯絡我們 | 免費諮詢支票貸款・支票貼現 | 泰誠企業融資',
  description: '立即聯絡泰誠企業融資，免費諮詢支票貼現、支票貸款服務。電話：02-XXXX-XXXX，週一至週五 09:00-18:00。',
}

export default function ContactPage() {
  return (
    <>
      {/* Hero */}
      <section style={{ backgroundColor: '#0D2B5E' }} className="text-white py-16 px-4">
        <div className="max-w-6xl mx-auto">
          <nav className="text-sm text-gray-400 mb-6">
            <Link href="/" className="hover:text-white">首頁</Link>
            <span className="mx-2">/</span>
            <span className="text-white">聯絡我們</span>
          </nav>
          <h1 className="text-4xl font-bold mb-4">聯絡我們</h1>
          <p className="text-gray-300 text-lg">免費諮詢，專業顧問為您規劃最適方案</p>
        </div>
      </section>

      <section className="py-16 px-4">
        <div className="max-w-6xl mx-auto">
          <div className="grid md:grid-cols-2 gap-12">

            {/* Contact Form */}
            <div>
              <h2 className="text-2xl font-bold text-[#0D2B5E] mb-6">填寫諮詢表單</h2>
              <p className="text-gray-500 text-sm mb-8">
                留下您的聯絡資料，顧問將在 1 個工作日內與您聯繫（不收諮詢費）
              </p>
              <form className="space-y-5">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    公司名稱 <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    placeholder="請輸入公司或商號名稱"
                    className="w-full px-4 py-3 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-[#0D2B5E] transition-colors"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    聯絡人姓名 <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    placeholder="請輸入姓名"
                    className="w-full px-4 py-3 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-[#0D2B5E] transition-colors"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    聯絡電話 <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="tel"
                    placeholder="請輸入手機或市話"
                    className="w-full px-4 py-3 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-[#0D2B5E] transition-colors"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    洽詢服務
                  </label>
                  <select className="w-full px-4 py-3 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-[#0D2B5E] transition-colors bg-white">
                    <option value="">請選擇服務項目</option>
                    <option value="tie-xian">支票貼現</option>
                    <option value="dai-kuan">支票貸款</option>
                    <option value="other">其他融資諮詢</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    需求金額（約）
                  </label>
                  <select className="w-full px-4 py-3 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-[#0D2B5E] transition-colors bg-white">
                    <option value="">請選擇</option>
                    <option>50萬以下</option>
                    <option>50～100萬</option>
                    <option>100～300萬</option>
                    <option>300～500萬</option>
                    <option>500萬以上</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    備註說明
                  </label>
                  <textarea
                    rows={4}
                    placeholder="請描述您的資金需求或其他問題..."
                    className="w-full px-4 py-3 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-[#0D2B5E] transition-colors resize-none"
                  />
                </div>
                <button
                  type="submit"
                  className="w-full py-4 rounded-lg font-bold text-white text-lg transition-opacity hover:opacity-90"
                  style={{ backgroundColor: '#C9922A' }}
                >
                  送出諮詢申請
                </button>
                <p className="text-xs text-gray-400 text-center">
                  送出即代表您同意我們聯繫您提供服務資訊。我們嚴格保護您的個人資料。
                </p>
              </form>
            </div>

            {/* Contact Info */}
            <div>
              <h2 className="text-2xl font-bold text-[#0D2B5E] mb-6">直接聯絡</h2>

              <div className="space-y-6">
                <div className="flex items-start gap-4 p-5 bg-gray-50 rounded-xl">
                  <span className="text-2xl">📞</span>
                  <div>
                    <h3 className="font-bold text-gray-800 mb-1">電話諮詢</h3>
                    <p className="text-[#0D2B5E] font-bold text-lg">02-XXXX-XXXX</p>
                    <p className="text-gray-500 text-sm mt-1">週一至週五 09:00 – 18:00</p>
                  </div>
                </div>

                <div className="flex items-start gap-4 p-5 bg-gray-50 rounded-xl">
                  <span className="text-2xl">📱</span>
                  <div>
                    <h3 className="font-bold text-gray-800 mb-1">手機專線</h3>
                    <p className="text-[#0D2B5E] font-bold text-lg">0900-XXX-XXX</p>
                    <p className="text-gray-500 text-sm mt-1">緊急案件可洽詢</p>
                  </div>
                </div>

                <div className="flex items-start gap-4 p-5 bg-gray-50 rounded-xl">
                  <span className="text-2xl">✉️</span>
                  <div>
                    <h3 className="font-bold text-gray-800 mb-1">Email</h3>
                    <p className="text-[#0D2B5E] font-bold">service@example.com</p>
                    <p className="text-gray-500 text-sm mt-1">1個工作日內回覆</p>
                  </div>
                </div>

                <div className="flex items-start gap-4 p-5 bg-gray-50 rounded-xl">
                  <span className="text-2xl">📍</span>
                  <div>
                    <h3 className="font-bold text-gray-800 mb-1">公司地址</h3>
                    <p className="text-gray-700">台北市中山區XX路XX號XX樓</p>
                    <p className="text-gray-500 text-sm mt-1">建議來訪前先預約</p>
                  </div>
                </div>
              </div>

              <div className="mt-8 p-6 rounded-xl" style={{ backgroundColor: '#F0F4FF' }}>
                <h3 className="font-bold text-[#0D2B5E] mb-3">免費諮詢承諾</h3>
                <ul className="space-y-2 text-sm text-gray-600">
                  <li className="flex items-center gap-2"><span className="text-green-500">✓</span> 不收任何諮詢費用</li>
                  <li className="flex items-center gap-2"><span className="text-green-500">✓</span> 1個工作日內回覆</li>
                  <li className="flex items-center gap-2"><span className="text-green-500">✓</span> 嚴格保密您的資料</li>
                  <li className="flex items-center gap-2"><span className="text-green-500">✓</span> 量身規劃融資方案</li>
                  <li className="flex items-center gap-2"><span className="text-green-500">✓</span> 費用清楚說明，不強迫</li>
                </ul>
              </div>
            </div>
          </div>
        </div>
      </section>
    </>
  )
}
