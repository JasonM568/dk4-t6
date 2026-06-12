# HANDOFF — 線上課程學習平台（希望學院）

> 工作交接文件。每次告一段落更新此檔，下次開工先讀這裡。
> 最後更新：**2026-06-12（已上線 production，會員系統已接希望學院 Supabase Auth）**

## 目前狀態：已部署上線 ✅

- **Production**：<https://course.huangxi.info>（2026-06-12 已綁定，vercel.app 網址仍可用）
- GitHub repo：<https://github.com/JasonM568/dk4-t6.git>（push `main` 即自動部署 production）
- Vercel 專案：`tjs-projects-435187fd/course-platform`
- dev server：`pnpm dev` → http://localhost:3000

---

## 🏗️ 架構（2026-06-12 重大改版）

**會員系統已從自建 Auth.js 改接希望學院（QBC）的 Supabase Auth**，學員資料唯一一份：

```
Supabase 專案 qubjpayeopvscrgrvrci（兩站共用）
├─ auth schema      ← Supabase Auth（87+ 位學員，hope/course 同帳密）
├─ public schema    ← QBC（hope.huangxi.info）的 76 張表，本專案唯讀 profiles
└─ course schema    ← 本專案 Prisma 獨佔（?schema=course）
    Course/Lesson/Order/OrderItem/Payment/Enrollment/
    MemberStats（等級統計，uuid PK）/MembershipTier/_prisma_migrations
```

- 設計依據與逐檔細節：**`REFACTOR_PLAN.md`**（完整改造計畫書）
- 登入/註冊/忘記密碼：Supabase Auth（`@supabase/ssr`，token_hash + verifyOtp 流程）
- admin 判斷：QBC `public.profiles.role`，對映集中在 `src/lib/auth/role.ts`（目前只認 `admin`）
- 會員分級制度：**前台已隱藏**（`TIER_SYSTEM_ENABLED = false` in `src/lib/membership/tier.ts`），後台統計照常累計，重新啟用改一個常數
- 本機開發：資料庫用本機 PG 的 course schema；登入直接打正式 Supabase Auth（只登入，絕不跑註冊/寫入測試）

### ⛔ 鐵則（碰正式庫前必讀）

1. Prisma **只管 course schema**，絕不開 multiSchema、絕不宣告 public model（會把 QBC 正式表判 drift，有毀滅性風險）
2. 絕不在自動化測試對正式 Supabase 註冊/寫入；測試一律本機 + 固定測試 uuid
3. `SUPABASE_SECRET_KEY` 只能在 server-only 模組（`src/lib/supabase/admin.ts`）
4. Supabase 專案層級設定（SMTP/信件模板/Redirect URLs）**兩站共用**，改動會影響 hope.huangxi.info
5. QBC 直連主機（`db.xxx:5432`）壞掉且 Vercel 不支援 IPv6，一律用 pooler：runtime 6543（pgbouncer）、migrate 5432（session pooler）

---

## ✅ 已完成

- [x] MVP 全功能（商店/下單/播放/後台/ECPay 金流/自動化測試）— 2026-06-06
- [x] 會員系統改接 Supabase Auth（移除 next-auth/bcrypt，學員與 QBC 同帳密）— 2026-06-12
- [x] course schema 隔離 + 重生 init migration
- [x] 忘記密碼/重置流程 + 60 秒重寄鎖鈕 + 防帳號枚舉（跨裝置可用）
- [x] 希望學院品牌重置信模板（`docs/email-templates/recovery.html`，LOGO 在 `public/brand/`）
- [x] 會員分級前台隱藏（TIER_SYSTEM_ENABLED 開關）
- [x] Vercel production 環境變數 + 部署上線；正式庫 course schema 已建立（已驗證 public/auth 零接觸）
- [x] 人工 smoke test：真帳號登入/登出 OK

## 📌 待辦（依優先序）

1. **Supabase Dashboard 設定（使用者操作，指南：`docs/email-templates/SETUP.md`）**：
   自訂 SMTP（建議 Resend）+ 寄件人「希望學院」+ Redirect URLs 白名單 + 貼品牌模板。
   ⚠️ 內建 SMTP 只寄團隊成員、每小時 2 封（Pro 方案也一樣）——這是 hope 站寄不出重置信的根因，設好兩站一起修好
2. **與 QBC 站協調**：信件模板改 `{{ .RedirectTo }}` 格式後，hope 站 reset 頁相容性回歸測試（上線重置功能前必須）
3. ~~綁網域~~ ✅ 已完成（`NEXT_PUBLIC_BASE_URL` 已改 course.huangxi.info；Supabase Redirect URLs 待辦 #1 一併設定）
4. **課程資訊調整**：目前是 seed 示範課程，正式課程內容由後台 `/admin` 建立（或提供資料批次匯入）
5. **正式金流**：ECPay 正式商店參數（目前是官方 sandbox）+ ReturnURL 設定 + 真實付款測試
6. hope 站加「課程專區」按鈕連到 course 站
7. 跨子網域 SSO（cookie domain `.huangxi.info`，登入一次兩站通行）— 第二階段優化
8. 課程進度追蹤、訂單逾期 cron、購物車 — 原 MVP 待辦
9. Google OAuth — 本次改版已移除，要做需在 Supabase 開 provider（影響 QBC，需獨立評估）

---

## ⚠️ 已知事項與決策

- **Prisma 鎖 6.x**；`package.json#prisma` seed 設定 Prisma 7 將棄用（屆時遷 `prisma.config.ts`）
- **Next 16**：middleware 慣例更名 `src/proxy.ts`；params/searchParams 是 Promise 要 await
- **金流抽換**：換藍新只需加 `src/lib/payment/newebpay.ts` + factory case + 改 `PAYMENT_PROVIDER`
- **git**：專案有 `[slug]`/`(auth)` 括號目錄，務必 `git add -A`，勿用括號路徑（zsh glob 危險）
- **Vercel**：push `main` 即自動 production 部署；env 變更後要重新部署才生效
- QBC 連線字串來源：Vercel `qbc-hope` 專案 env（`vercel env pull`）；Supabase Dashboard 重設密碼曾未生效，現行密碼以 Vercel 存的為準

## 🧪 快速驗證指令

```bash
npx tsx scripts/test-ecpay.ts          # 簽章正確性
npx tsx scripts/test-purchase-flow.ts  # 付款 webhook + 冪等（需 dev server）
npx tsx scripts/reset-testuser.ts      # 重置固定測試 uuid 的資料
pnpm tsc --noEmit && pnpm build        # 型別 + 正式 build
```
