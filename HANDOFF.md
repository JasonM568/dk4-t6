# HANDOFF — 線上課程學習平台

> 工作交接文件。每次告一段落更新此檔，下次開工先讀這裡。
> 最後更新：**2026-06-08（部署進行中，卡在 QBC 資料庫密碼）**

## 目前狀態：MVP 完成，本地可跑、測試全通過

GitHub repo：<https://github.com/JasonM568/dk4-t6.git>（`main` 已 push）
dev server：`pnpm dev` → http://localhost:3000
測試帳號：管理員 `admin@example.com/admin1234`、學員 `user@example.com/user1234`

---

## ✅ 已完成（2026-06-06）

- [x] 專案 scaffold（Next.js 16 + TS + Tailwind v4 + src/@alias）
- [x] Prisma schema + 本機 PostgreSQL 16 migrate + seed（3 等級 / 2 帳號 / 3 課程）
- [x] Auth.js v5 帳密登入註冊 + JWT + role/tier 注入 + edge-safe 拆分
- [x] 路由保護 `src/proxy.ts`（會員區 + /admin 角色檢查）
- [x] 金流統一抽換層 + ECPay adapter（CheckMacValue 簽章）
- [x] notify webhook：驗章 + 訂單狀態機 + 冪等 + 自動入帳 + 等級重算
- [x] 商店（列表/詳情）+ 下單（折扣）+ 我的課程 + 播放頁（enrollment 閘門）
- [x] 訂單管理（會員端 + 後台）
- [x] 後台：課程 CRUD、章節管理、訂單查詢、會員與等級規則設定
- [x] 自動化測試：簽章、付款流程（含冪等）、等級升級 — 全通過
- [x] 本地 git 初始 commit
- [x] Push 到 GitHub（2026-06-08）— remote `origin` → JasonM568/dk4-t6

---

## 🚧 部署進度（2026-06-08，進行中 — 卡在資料庫密碼）

**目標**：部署到 Vercel + Supabase（原規劃 Neon，使用者慣用 Supabase，已改）。本輪先做 **Preview** 部署。

已完成：
- [x] `vercel link` → 專案 `tjs-projects-435187fd/course-platform`，已自動連 GitHub repo `dk4-t6`
- [x] `package.json` build script 改為 `prisma generate && prisma migrate deploy && next build`（部署時自動套 migration）

**資料庫決策（未定，待使用者拍板）**：課程平台服務的學員與另一個 Supabase 資料庫 **QBC**（`db.qubjpayeopvscrgrvrci.supabase.co`）是同一群人。三條路：
- **A. 共用 QBC DB ＋ 獨立 `course` schema**（Prisma 加 `schema="course"`，+$0，避免撞名）← 我的建議
- **B. 共用 QBC DB ＋ 共用會員表**（單一登入，工程最大，需重做 auth，先別做）
- **C. 新開獨立 Supabase project**（+$10/月，Pro 方案多一個 Micro compute）

⛔ **重要安全提醒**：本平台 Prisma schema **自帶完整會員系統**（`User`/`Account`/`MembershipTier`…）。**絕對不要**直接對 QBC 的 `public` schema 跑 `prisma migrate deploy` —— 會跟 QBC 既有表撞名／污染正式資料庫。共用前務必先唯讀檢查 QBC 既有 schema/表，並改用獨立 `course` schema。

**目前卡關**：使用者提供的 QBC direct 連線字串（port 5432）`password authentication failed for user "postgres"` → 需重新確認／reset 資料庫密碼才能繼續唯讀檢查。

**下次開工步驟**：
1. 拿到正確 QBC 連線字串 → 唯讀 `psql ... -c "\dt *.*"` 檢查既有表，確認撞名風險
2. 拍板 A/B/C；走 A 則 Prisma schema 各 model 加 `@@schema("course")` + datasource 加 `schemas=["course"]` + `previewFeatures=["multiSchema"]`
3. 用 CLI 設 Vercel 環境變數：
   - `DATABASE_URL` → Supabase **Transaction pooler**（`...pooler.supabase.com:6543`，app 用）
   - `DATABASE_URL_UNPOOLED` → **Direct/Session**（5432，migrate 用）
   - `AUTH_SECRET`（產新的：`openssl rand -base64 32`）、`PAYMENT_PROVIDER=ecpay`、`ECPAY_*`（沿用官方 sandbox 憑證）
   - `NEXT_PUBLIC_BASE_URL` → 首次部署拿到 Preview 網址後再回填
4. `vercel`（preview 部署）→ 驗證 build + migration → 設 ECPay ReturnURL → 確認後再 `vercel --prod`

---

## 📌 待辦（依優先序）

1. **完成 Vercel + Supabase 部署**（見上方「部署進度」，先 Preview 後 Production）
2. **真實金流測試**：`ngrok http 3000` → 改 `.env` 的 `NEXT_PUBLIC_BASE_URL` → ECPay sandbox 信用卡跑完整付款
3. Google OAuth 登入（填 `AUTH_GOOGLE_ID/SECRET` 即啟用，登入頁按鈕 UI 待補）
4. 購物車（一次買多門課；目前是單門直接結帳）
5. 課程進度追蹤（已看章節、完課率）
6. 訂單逾期處理（PENDING → EXPIRED 的 cron）
7. 後台刪除課程：若已有售出 OrderItem 會被 FK 擋下，需先處理（軟刪除或擋 UI）

---

## ⚠️ 已知事項與決策

- **資料庫**：本機沒 Docker，改用既有 Homebrew **PostgreSQL 16**（DB `course_platform`，無密碼）。正式環境用 **Supabase**（原規劃 Neon，已改成使用者慣用的 Supabase）。
- **Prisma 鎖 6.x**：create-next-app 帶進 Prisma 7（破壞性變更多），已降版求穩。升 7 時注意新 generator/output/prisma.config.ts。
- **Next 16**：`middleware` 慣例已更名 `proxy`，故檔名是 `src/proxy.ts`。params/searchParams 為 Promise，需 await。
- **金流抽換**：要換藍新只需加 `src/lib/payment/newebpay.ts` + factory 加 case + 改 `PAYMENT_PROVIDER`。
- **git**：專案有 `[slug]`/`(auth)` 括號目錄，務必用 `git add -A`，勿用括號路徑（zsh glob 危險）。

---

## 🧪 快速驗證指令

```bash
npx tsx scripts/test-ecpay.ts          # 簽章正確性
npx tsx scripts/test-purchase-flow.ts  # 付款 webhook + 冪等（需 dev server 開著）
npx tsx scripts/reset-testuser.ts      # 重置測試會員為乾淨狀態
pnpm build                             # 正式 build 驗證
```
