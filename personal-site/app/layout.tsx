import type { Metadata } from "next";
import { Geist } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "陳孟宏 | AI 導入策略顧問 × Vibe Coding 家教",
  description:
    "協助企業找到最適合的 AI 導入方式，讓 AI 真正落地，提升效率、優化流程，創造營運價值。同時提供 Vibe Coding 個人家教課程。",
  openGraph: {
    title: "陳孟宏 | AI 導入策略顧問 × Vibe Coding 家教",
    description: "協助企業 AI 落地 × 教你用 Claude Code 做出真實作品",
    type: "website",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-TW" className={`${geistSans.variable} h-full`}>
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
