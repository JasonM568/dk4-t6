'use client'

import Link from 'next/link'
import { useState } from 'react'

const navLinks = [
  { href: '/', label: '首頁' },
  { href: '/zhi-piao-tie-xian', label: '支票貼現' },
  { href: '/zhi-piao-dai-kuan', label: '支票貸款' },
  { href: '/faq', label: '常見問題' },
  { href: '/contact', label: '聯絡我們' },
]

export default function Header() {
  const [open, setOpen] = useState(false)

  return (
    <header className="sticky top-0 z-50 bg-white shadow-sm">
      <div className="max-w-6xl mx-auto px-4 flex items-center justify-between h-16">
        <Link href="/" className="flex items-center gap-2">
          <span className="text-2xl font-bold" style={{ color: '#0D2B5E' }}>泰誠</span>
          <span className="text-sm text-gray-500 hidden sm:block">企業融資</span>
        </Link>

        {/* Desktop nav */}
        <nav className="hidden md:flex items-center gap-6">
          {navLinks.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="text-gray-600 hover:text-[#0D2B5E] text-sm font-medium transition-colors"
            >
              {link.label}
            </Link>
          ))}
          <Link
            href="/contact"
            className="px-4 py-2 rounded text-white text-sm font-bold transition-opacity hover:opacity-90"
            style={{ backgroundColor: '#C9922A' }}
          >
            立即諮詢
          </Link>
        </nav>

        {/* Mobile hamburger */}
        <button
          className="md:hidden p-2 text-gray-600"
          onClick={() => setOpen(!open)}
          aria-label="選單"
        >
          <div className="w-5 space-y-1">
            <span className={`block h-0.5 bg-current transition-all ${open ? 'rotate-45 translate-y-1.5' : ''}`} />
            <span className={`block h-0.5 bg-current transition-all ${open ? 'opacity-0' : ''}`} />
            <span className={`block h-0.5 bg-current transition-all ${open ? '-rotate-45 -translate-y-1.5' : ''}`} />
          </div>
        </button>
      </div>

      {/* Mobile menu */}
      {open && (
        <div className="md:hidden border-t border-gray-100 bg-white px-4 pb-4">
          {navLinks.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              onClick={() => setOpen(false)}
              className="block py-3 text-gray-600 border-b border-gray-50 text-sm"
            >
              {link.label}
            </Link>
          ))}
          <Link
            href="/contact"
            onClick={() => setOpen(false)}
            className="mt-3 block text-center px-4 py-3 rounded text-white text-sm font-bold"
            style={{ backgroundColor: '#C9922A' }}
          >
            立即諮詢
          </Link>
        </div>
      )}
    </header>
  )
}
