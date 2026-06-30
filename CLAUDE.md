# 希望學院課程平台 — AI 工作指南

> 正式站：https://course.huangxi.info｜GitHub push `main` 自動部署 Vercel

## 技術棧

- Next.js 16（App Router + Server Actions）+ React 19 + TypeScript
- Prisma 6 + PostgreSQL（course schema 獨佔）
- Supabase Auth（共用 QBC 的 Supabase 專案 `qubjpayeopvscrgrvrci`）
- Vercel 部署、Resend 郵件、ECPay 金流

## 資料庫架構（務必理解）

```
Supabase 專案 qubjpayeopvscrgrvrci（hope 站與 course 站共用）
├─ auth schema      ← Supabase Auth（學員帳密，兩站共通）
├─ public schema    ← QBC（hope.huangxi.info）76 張表，本專案唯讀 profiles
└─ course schema    ← 本專案 Prisma 獨佔（?schema=course）
    Course / Lesson / Order / OrderItem / Payment
    Enrollment / MailGroup / MemberStats / MembershipTier
```

## ⛔ 鐵則（動資料庫前必讀）

1. **Prisma 只管 course schema**，絕不開 multiSchema、絕不宣告 public model（會把 QBC 正式表判 drift，有毀滅性風險）
2. **絕不對正式 Supabase 跑自動化測試的註冊/寫入**；測試一律本機 + 固定測試 uuid
3. `SUPABASE_SECRET_KEY` 只能在 server-only 模組（`src/lib/supabase/admin.ts`）
4. Supabase 專案設定（SMTP / 信件模板 / Redirect URLs）**兩站共用**，改動會影響 hope.huangxi.info
5. 連線一律用 pooler：runtime 用 6543（pgbouncer）、migrate 用 5432（session pooler）；勿直連主機

## ⚠️ Prisma Migration 注意事項

- `prisma migrate diff --from-url` 產出的 SQL **不可信**（曾產出刪整個 course schema 的指令）
- 手寫 migration 流程：手寫 SQL → 本機 `migrate deploy` 驗證 → grep 確認無 `public.` / `auth.` 字樣再推

## 重要概念區分

- **MailGroup**（名單群組）= EDM 電子報寄信名單
- **Enrollment**（觀看權限）= 能不能看課程
- 兩套獨立、互不影響；加名單群組不會開通課程

## 權限架構

- admin 判斷：QBC `public.profiles.role`，對映在 `src/lib/auth/role.ts`
- 後台 RBAC 三級（StaffRole 表）：管理員 / 操作人員 / 總教練
- 守門邏輯：`src/lib/auth/staff.ts`

## 目前待辦（依優先序）

0. P1–P3 約 25 項安全/邏輯 bug（越權改密碼、結帳冪等、免費課 total=0、open redirect 等）
1. ECPay 換正式商店參數（目前仍 sandbox）
2. hope 站 Confirm email 回歸測試（開關是專案層級，已影響 hope 站）
3. 三分頁（量子講師群 / 知識專區 / 講座邀約）補正式內容

## 常用指令

```bash
pnpm dev                              # 啟動開發伺服器 http://localhost:3000
pnpm tsc --noEmit && pnpm build       # 型別檢查 + 正式 build
npx tsx scripts/test-ecpay.ts         # 驗 ECPay 簽章
npx tsx scripts/test-purchase-flow.ts # 付款 webhook 端到端（需 dev server）
npx tsx scripts/reset-testuser.ts     # 重置測試會員
```

## 目錄重點

```
src/lib/auth/role.ts          admin / role 判斷
src/lib/auth/staff.ts         RBAC 守門
src/lib/payment/              金流抽換層（換金流只改這裡 + env）
src/lib/membership/tier.ts    等級重算（TIER_SYSTEM_ENABLED 開關）
src/lib/supabase/admin.ts     service key，server-only
src/proxy.ts                  路由保護（Next 16 middleware）
src/actions/                  Server Actions（checkout / auth / admin）
prisma/schema.prisma          資料模型（course schema only）
```

## git 注意

專案含 `[slug]`、`(auth)` 括號目錄，務必用 `git add -A`，勿用括號路徑（zsh glob 危險）。
