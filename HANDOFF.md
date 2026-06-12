# HANDOFF — 線上課程學習平台（希望學院）

> 工作交接文件。每次告一段落更新此檔，下次開工先讀這裡。
> 最後更新：**2026-06-12 晚（已上線 + 後台功能大擴充 + SMTP 通了，剩 Confirm email 開關與正式金流）**

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

**2026-06-06**
- [x] MVP 全功能（商店/下單/播放/後台/ECPay 金流/自動化測試）

**2026-06-12（上線日）**
- [x] 會員系統改接 Supabase Auth（移除 next-auth/bcrypt，學員與 QBC 同帳密）
- [x] course schema 隔離 + Vercel 部署上線 + 綁定 course.huangxi.info
- [x] 自訂 SMTP（Resend + huibang.com.tw）+ 品牌重置信——**忘記密碼全流程實測成功**
- [x] 全站品牌「希望學院學習平台」（站名/LOGO/favicon）
- [x] 會員分級前台隱藏（`TIER_SYSTEM_ENABLED` 開關，結帳一律原價）

**2026-06-12 後台功能大擴充**
- [x] 會員新增：單筆表單 + 批次匯入（欄位順序不限，自動辨識姓名/email/密碼）
- [x] 批次開通觀看權限（選課程 + email 名單，冪等）
- [x] 會員詳情頁：基本資料/權限清單（下拉新增+逐筆移除）/訂單紀錄
- [x] 未登入會員清單 + 批次重設密碼（`/admin/members/inactive`）
- [x] 課程：分類管理（複選）、課程編號、排序（上移/下移）、雙價格（建議售價劃線+優惠價）
- [x] 課程內容：封面/介紹圖上傳、章節行內編輯、線上簡報嵌入（Google Slides/Canva）、講義上傳下載
- [x] YouTube 容錯（網址/嵌入碼/純 ID 皆可）；課程表單驗證錯誤友善顯示
- [x] 群發通知（`/admin/broadcast`：品牌信+課程卡片，先測試後群發，Resend batch API，寄送紀錄）
- [x] 註冊確認信「程式端」備妥（emailRedirectTo + confirm-signup.html 模板）——**Dashboard 開關未開**
- 會員數：135（原 QBC 87 + 本日匯入）；Storage：course-assets bucket（圖片 5MB/文件 20MB）

## 📌 待辦（依優先序）

1. **開啟註冊確認信**（使用者操作）：Dashboard → Auth → Sign In/Up → Confirm email 開啟 + 貼 `docs/email-templates/confirm-signup.html` 模板（步驟在 SETUP.md）。⚠️ 開啟後立即測 hope 站註冊，hope 端若沒處理確認連結要關回
2. **與 QBC 站協調**：Recovery 模板已改 `{{ .RedirectTo }}` 格式，hope 站 reset 頁相容性回歸測試
3. **正式金流**：ECPay 正式商店參數（目前是官方 sandbox）+ 真實付款測試
4. **正式課程內容**：後台建立真實課程（分類選項也要先建）
5. hope 站加「課程專區」按鈕連到 course 站
6. Resend API key 曾貼在對話中，建議 rotate（rotate 後更新本機 .env 與 Vercel 的 RESEND_API_KEY）
7. 跨子網域 SSO（cookie domain `.huangxi.info`）— 第二階段優化
8. 課程進度追蹤、訂單逾期 cron、購物車 — 原 MVP 待辦
9. Google OAuth — 需在 Supabase 開 provider（影響 QBC，需獨立評估）

---

## ⚠️ 已知事項與決策

- **Prisma 鎖 6.x**；`package.json#prisma` seed 設定 Prisma 7 將棄用（屆時遷 `prisma.config.ts`）
- ⛔ **`prisma migrate diff --from-url` 產出的 SQL 不可信**（曾產出砍整個 course schema 的指令）——需要手寫 migration 時照 `20260612*_categories_course_code` 的做法：手寫 SQL → 本機 `migrate deploy` 驗證 → grep 確認無 `public./auth.` 字樣
- **群發信額度**：Resend 免費方案 100 封/天、3,000 封/月（含 Auth 信），群發 135 人接近日上限，當天避免同時大量寄驗證信
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
