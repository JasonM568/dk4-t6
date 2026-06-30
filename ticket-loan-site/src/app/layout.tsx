import type { Metadata } from 'next'
import './globals.css'
import Header from '@/components/Header'
import Footer from '@/components/Footer'

export const metadata: Metadata = {
  title: {
    template: '%s | 泰誠企業融資',
    default: '泰誠企業融資 | 支票貸款・支票貼現專家',
  },
  description: '專業企業融資服務，支票貼現、支票貸款快速審核，協助中小企業解決資金周轉問題。24小時諮詢，最快當日撥款。',
  keywords: ['支票貸款', '支票貼現', '企業融資', '票貼', '企業周轉金', '支票融資', '遠期支票貸款', '支票借款'],
  openGraph: {
    type: 'website',
    locale: 'zh_TW',
    siteName: '泰誠企業融資',
    title: '泰誠企業融資 | 支票貸款・支票貼現專家',
    description: '專業企業融資服務，支票貼現、支票貸款快速審核，協助中小企業解決資金周轉問題。',
  },
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-TW">
      <body className="min-h-screen bg-white text-gray-900">
        <Header />
        <main>{children}</main>
        <Footer />
      </body>
    </html>
  )
}
