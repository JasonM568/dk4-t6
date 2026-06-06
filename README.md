# 線上課程學習平台

會員制線上課程網站 — 會員註冊/登入、會員分級（依消費自動升級）、購買課程、訂單管理、課程觀看、後台管理。

## 技術棧

- **Next.js 16**（App Router, Server Actions）+ React 19 + TypeScript
- **Prisma 6** + **PostgreSQL**（本地 Homebrew / 正式 Neon）
- **Auth.js (NextAuth v5)** — 帳密 + Google OAuth，JWT session
- **ECPay 綠界** 金流（統一可抽換介面，sandbox 測試）
- **Tailwind CSS v4**

## 核心功能

| 功能 | 說明 |
|------|------|
| 會員系統 | 註冊 / 登入 / 登出，密碼 bcrypt 雜湊 |
| 會員分級 | 銅/銀/金，依「累積消費」自動升級，享 0/5/10% 折扣（後台可調門檻） |
| 購買課程 | 折扣於下單時 server 端計算 → 導向 ECPay 收銀台 |
| 訂單管理 | 訂單狀態機 PENDING→PAID/FAILED，會員端與後台皆可查 |
| 金流 webhook | ECPay notify 驗章 + 冪等 + 自動建立 enrollment + 重算等級 |
| 我的課程 | 已購課程觀看，播放頁以 enrollment 為唯一權限來源 |
| 後台 | 課程 CRUD、章節管理、訂單查詢、會員與等級規則設定 |

## 快速開始

```bash
# 1. 安裝依賴
pnpm install

# 2. 啟動本地 Postgres（Homebrew）並建立資料庫
brew services start postgresql@16
createdb course_platform   # 若已存在可略過

# 3. 套用 schema 並灌入種子資料
pnpm prisma migrate dev
pnpm db:seed

# 4. 啟動
pnpm dev   # http://localhost:3000
```

### 預設帳號（seed）

| 角色 | 帳號 | 密碼 |
|------|------|------|
| 管理員 | admin@example.com | admin1234 |
| 學員 | user@example.com | user1234 |

## 環境變數（`.env`）

```
DATABASE_URL / DATABASE_URL_UNPOOLED   # Postgres 連線
AUTH_SECRET                            # npx auth secret 產生
AUTH_GOOGLE_ID / AUTH_GOOGLE_SECRET    # 選填，填了才有 Google 登入
PAYMENT_PROVIDER=ecpay
ECPAY_MERCHANT_ID / ECPAY_HASH_KEY / ECPAY_HASH_IV / ECPAY_API_URL
NEXT_PUBLIC_BASE_URL                   # 組 ReturnURL；本地測金流時改 ngrok 網址
```

> 預設已填入 ECPay 官方公開的 **sandbox 測試憑證**（MerchantID 2000132），可直接測試。

## 測試金流（端到端）

ECPay 的 server-to-server 通知（notify）需要公開 URL，localhost 收不到，需用 ngrok：

```bash
# 1. 開隧道
ngrok http 3000
# 2. 把 .env 的 NEXT_PUBLIC_BASE_URL 改成 ngrok 網址，重啟 pnpm dev
# 3. 登入 → 課程詳情 → 立即購買 → 用 ECPay sandbox 測試信用卡付款
#    付款成功後 ECPay 會打 /api/payment/ecpay/notify → 訂單轉 PAID、課程入帳、等級重算
```

### 自動化測試腳本

```bash
npx tsx scripts/test-ecpay.ts          # CheckMacValue 簽章正確性
npx tsx scripts/test-purchase-flow.ts  # 付款 webhook → 入帳 → 冪等（需 dev server 開著）
npx tsx scripts/reset-testuser.ts      # 把測試會員重置為乾淨狀態
```

## 部署到 Vercel

1. 推到 GitHub，於 Vercel 匯入專案
2. Vercel Marketplace 開 **Neon** → 自動注入 `DATABASE_URL`
3. 設定其餘環境變數（AUTH_SECRET、ECPAY_*、NEXT_PUBLIC_BASE_URL=正式網域）
4. Build Command 設為：`prisma generate && prisma migrate deploy && next build`
5. 到 ECPay 後台把 ReturnURL 設為 `https://你的網域/api/payment/ecpay/notify`

## 換金流商（ECPay → 藍新）

金流走統一介面 `src/lib/payment/types.ts`。新增 `newebpay.ts` 實作 `PaymentProvider`，
在 `src/lib/payment/index.ts` 的 factory 加上 `case "newebpay"`，改環境變數 `PAYMENT_PROVIDER` 即可，
其餘下單/webhook 程式碼不需改動。

## 目錄重點

```
prisma/schema.prisma                          資料模型
src/auth.ts / auth.config.ts                  驗證（edge-safe 拆分）
src/proxy.ts                                   路由保護（Next 16 的 middleware）
src/lib/payment/                               金流抽換層 + ECPay 簽章
src/lib/membership/tier.ts                     等級重算 + 折扣
src/actions/                                   checkout / auth / admin server actions
src/app/api/payment/ecpay/notify/route.ts     付款 webhook（狀態機 + 冪等 + 入帳）
src/app/(member)/learn/[courseSlug]/page.tsx   播放頁（enrollment 權限閘門）
src/app/(admin)/admin/                         後台
```
