import type { Metadata } from "next";
import "./globals.css";
import { Navbar } from "@/components/navbar";

export const metadata: Metadata = {
  title: "希望學院學習平台",
  description: "希望學院學習平台 — 註冊、購課、線上觀看、訂單管理",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-Hant" className="h-full antialiased">
      <body className="flex min-h-full flex-col bg-white text-gray-900">
        <Navbar />
        {/* flex-col：讓子頁可用 flex-1 撐滿剩餘高度（如企業專區的整頁漸層底） */}
        <main className="flex flex-1 flex-col">{children}</main>
        <footer className="border-t border-gray-200 py-6 text-center text-xs text-gray-400">
          © 2026 希望學院學習平台 HOPE Academy
        </footer>
      </body>
    </html>
  );
}
