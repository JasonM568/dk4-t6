import Link from 'next/link'

export default function Footer() {
  return (
    <footer style={{ backgroundColor: '#0D2B5E' }} className="text-white">
      <div className="max-w-6xl mx-auto px-4 py-12">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
          <div>
            <h3 className="text-xl font-bold mb-3">泰誠企業融資</h3>
            <p className="text-gray-300 text-sm leading-relaxed">
              專業提供支票貼現、支票貸款服務。<br />
              協助中小企業解決資金周轉問題，<br />
              快速審核，安全合法。
            </p>
          </div>

          <div>
            <h4 className="font-bold mb-3 text-[#C9922A]">服務項目</h4>
            <ul className="space-y-2 text-sm text-gray-300">
              <li><Link href="/zhi-piao-tie-xian" className="hover:text-white transition-colors">支票貼現</Link></li>
              <li><Link href="/zhi-piao-dai-kuan" className="hover:text-white transition-colors">支票貸款</Link></li>
              <li><Link href="/faq" className="hover:text-white transition-colors">常見問題</Link></li>
              <li><Link href="/contact" className="hover:text-white transition-colors">聯絡我們</Link></li>
            </ul>
          </div>

          <div>
            <h4 className="font-bold mb-3 text-[#C9922A]">聯絡資訊</h4>
            <ul className="space-y-2 text-sm text-gray-300">
              <li>📞 02-XXXX-XXXX</li>
              <li>📱 0900-XXX-XXX</li>
              <li>✉️ service@example.com</li>
              <li>🕐 週一至週五 09:00–18:00</li>
              <li>📍 台北市中山區XX路XX號</li>
            </ul>
          </div>
        </div>

        <div className="mt-8 pt-6 border-t border-white/10 text-xs text-gray-400 space-y-2">
          <p>
            免責聲明：本公司所有融資服務均依法辦理。貸款有風險，借貸需謹慎。
            實際核准金額與條件依審核結果為準，本網站資訊僅供參考。
          </p>
          <p>© {new Date().getFullYear()} 泰誠企業融資 版權所有</p>
        </div>
      </div>
    </footer>
  )
}
