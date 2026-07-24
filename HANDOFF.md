# HANDOFF — 線上課程學習平台（希望學院）

> 工作交接文件。每次告一段落更新此檔，下次開工先讀這裡。
> 最後更新：**2026-07-25（session 逾時設定 + 472 位學員大批匯入執行順序規劃）**
>
> 🔑 **重要：course schema 現在可直接查了**——已 expose 且 `GRANT SELECT ... TO service_role`。
> 用 supabase service key + `sb.schema("course").from("Enrollment"/"MailGroup"/...)` 即可查正式 course 資料，
> debug 不必再請使用者跑 SQL。（auth/profiles 一直可查；course 是這天才打通）
>
> ⚠️ **概念易混淆（已在 UI 標清楚）**：「名單群組 MailGroup」= EDM 電子報寄信名單；
> 「課程觀看權限 Enrollment」= 能不能看課程。**兩套獨立、互不影響**。加名單群組不會開通課程。

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
- [x] 註冊確認信「程式端」備妥（emailRedirectTo + confirm-signup.html 模板）
- 會員數：135（原 QBC 87 + 本日匯入）；Storage：course-assets bucket（圖片 5MB/文件 20MB）

**2026-06-12 深夜**
- [x] **Confirm email 已開啟**（Dashboard 開關 + 品牌模板），course 站註冊實測收到確認信 ✅
- [x] 註冊姓名開放英文（中英文皆可、至少 2 字，容許空格/·/-/'/.）
- [x] 前台三分頁：`/lecturers` 量子講師群、`/knowledge` 知識專區、`/speaking` 講座邀約（目前為「內容籌備中」版面）
- [x] 後台「分頁管理」`/admin/settings`：三分頁可逐頁開/關（關閉 = navbar 消失 + 直連 404），預設全開
- [x] 新增 `SiteSetting` key-value 表（手寫 migration `20260612230000_site_settings`，本機驗證過；正式庫由 Vercel build 的 migrate deploy 自動建立）
**2026-06-13（功能大擴充日，全數已部署上線）**
- [x] 註冊姓名開放英文 + 前台三分頁驗收完成（首頁 navbar、404 開關都正常）
- [x] 課程管理：⠿ 拖曳排序、⤒ 置頂、課程複製（連章節/講義/分類，複本未上架 slug-copy）
- [x] 管理員免購買可看全部課程（含未上架預覽）
- [x] **群發升級電子報系統**：
  - 預設發送時間（排程寄送）：Vercel Cron 每 5 分鐘（`/api/cron/broadcast`，CRON_SECRET 已設於 Vercel + 本機 .env）
  - MailGroup/MailGroupMember 名單群組：管理頁、CSV 匯入（UTF-8/Big5 容錯）、範本下載（public/templates/）
  - 發送對象三選一：全部會員/名單群組/手動貼名單；手動名單寄後可一鍵存群組
  - 寄送紀錄：狀態欄、取消排程、名單快照存入群組
- [x] 批次開通「查無會員」→ 一鍵批次新增會員並開通；匯入明確標示跳過已註冊
- [x] 會員管理（原會員與等級）：搜尋欄、名單群組複選篩選、初始密碼備查欄（MemberPassword 表，四個設密碼入口都記錄）
- [x] 後台表單全面補「送出中」狀態（SubmitButton 元件）

**2026-06-13 深夜（RBAC + P0 修復 + 大量 bug 修，全數已部署）**
- [x] **開通來源細分**（PURCHASE/MANUAL/BATCH/IMPORT，Enrollment.source）+ **每堂課觀看權限名單**（可新增/勾選移除/匯出/同步到名單群組）
- [x] 課程頁按權限顯示「觀看影片／購買課程」按鈕
- [x] 會員管理：登入時間欄、密碼遮蔽+點擊顯示+重設、勾選會員→加名單群組、**勾選會員→直接開通課程觀看權限**、依課程查名單+匯出；**會員列表顯示全部**（移除前 100 截斷）
- [x] **後台 RBAC 三級權限**（StaffRole 表）：管理員(全部)/操作人員(可編輯+匯出+批次+群發)/總教練(只查看訂單/課程/會員)。
  三層防護：action `requireEditor`/`requireFullAdmin` + 編輯頁 `pageGuardEditor` redirect + 查看頁依角色隱藏編輯鈕。權限管理頁 `/admin/staff`（admin 指派幹部）。守門邏輯在 `src/lib/auth/staff.ts`
- [x] **P0 修復（workflow 跑出 39 findings 後修的 11 項）**：B7 漏開根因徹底修（createMember 反查 auth id，batchEnroll 只反查不建）、B4/5/6 listProfiles/listAuthMeta 分頁、B9 Resend 逐封結果、B8 cron 回收卡死 SENDING(claimedAt)、B1/B2 金流驗金額+移除沙箱 fallback、B3 密碼遮蔽、B25 auth BASE_URL fallback
- [x] **學員端 force-dynamic**（my-courses/learn/courses[slug]）：修「QBC 老會員先登入、後被批次開通、看到舊快取沒新課程」

**2026-07-22（世華會學習專區＝企業專區系統）**
- [x] **泛用企業專區模型**：`CourseGroup`（專區）/`CourseGroupMember`（會籍，email 小寫為鍵、userId 稽核回填）/`GroupInviteCode`（邀請碼）三表 + `Course.groupId`（migration `20260722104816_course_groups`，全 additive）
- [x] **可見性防線四處**收斂到 `src/lib/course-access.ts` 的 `publicCourseWhere()`：課程列表/首頁不出現專區課、直連詳情 redirect 到專區擋牆、**checkout 擋專區課下單**（拿 courseId 也買不到）。之後任何新增課程查詢（sitemap/搜尋）都必須用這個 helper
- [x] 前台 `/zone/[groupSlug]`：專區會員（或後台幹部預覽）看課程列表（無價格、標已開通/未開通）；非會員看擋牆（未登入→登入/註冊、已登入→輸邀請碼 `redeemInviteAction`）。navbar 入口走 SITE_PAGES（key `shihua`）
- [x] 後台 `/admin/zones`（課程管理子分頁「企業專區」，editor 可管）：專區 CRUD/停用、會籍單筆+批次匯入（冪等 skipDuplicates、回填 userId）、邀請碼產生/停用/複製連結、擋牆文案
- [x] 課程表單加「所屬專區」下拉；`duplicateCourse` 連 groupId 一併複製；課程列表加專區 badge
- [x] 邀請註冊：`/register?invite=CODE` 預填、registerAction 先驗碼再建帳號、signUp 成功即寫會籍（email 為鍵，不受 Confirm email 時序影響）；邀請碼驗證/兌換共用 `src/lib/zone-invite.ts`
- [x] 觀看權限**完全沿用 Enrollment**：專區課仍到「批次開通」逐課開通，`/admin/enrollments` 零改動
- [x] 本機驗證全過：公開列表 0 洩漏、詳情 307 redirect、擋牆 200、分頁開關 404、lint/build 過
- ⚠️ **`page:shihua` 預設 off**（migration `20260722110000`）：上線後 navbar 不會出現入口。啟用流程＝後台「企業專區」建立專區（slug 必須是 `shihua`）→ 匯入會員名單/發邀請碼 → 「分頁管理」開啟「世華會學習專區」

**2026-07-22 晚（世華會上線調整＋後台重整，全數已部署）**
- [x] 世華會專區已在正式站啟用：修正 slug（使用者誤填 `shihua-0721-ai-course` → `shihua`）、`page:shihua` 已開
- [x] 專區主題配色（`themePrimary/themeAccent`，migration `20260722112810`）：後台專區「基本資料」色票設定；世華會 = `#b17ad5`/`#da9af0`（正式庫已設）；整頁漸層底（layout main 改 flex-col、子頁 flex-1 撐滿）
- [x] **後台導覽重整**：批次開通移到會員管理、企業專區升主導覽、名單群組歸位 Email群發子分頁；分區邏輯＝課程管內容/會員管人/專區管包班/群發管行銷
- [x] 會員列表勾選批次操作三合一：開通課程／**加入企業專區（新，`addMembersToZoneBulkAction`）**／加入名單群組
- 決策：世華會維持**逐課開通**（入會≠能看影片）；使用者已知邀請連結註冊後需等管理員開通，發群組訊息時要註明
- [x] 後台容器留白統一（px-6/sm:px-8/lg:px-12）
- [x] **會員列表頁重整**：移除「依課程查觀看名單」區塊（與 courses/[id]/members 重複）→ 右上捷徑下拉跳轉；批次面板勾選才浮現；欄位 9→7（等級欄綁 `TIER_SYSTEM_ENABLED`、角色改姓名旁徽章）
- [x] **修「後台類別列每頁位移」**（Jason 反映三次，真因=main 改 flex-col 後 mx-auto 子容器 shrink-to-fit）：`globals.css` 加 `main > * { width:100% }`；順帶保留 `overflow-y:scroll` + `scrollbar-gutter:stable`（防捲軸位移）。⚠️ 動 main/layout 結構前先讀 globals.css 註解

**2026-07-25（Supabase session 逾時設定，Dashboard 操作、無程式改動）**
- [x] 調查「登入後永不登出」：確認是 Supabase Auth 預設行為（refresh token 無限續命 + cookie ~400 天），非程式 bug
- [x] 依 Jason 決定開啟專案層級逾時（Dashboard → Authentication → Sessions，需 Pro plan）：**Time-box `24` 小時**（每天強制重登，蓋過 inactivity）＋ **Inactivity timeout `168` 小時**
- 生效機制：不會立刻踢掉現有 session，下次 token 刷新（≤1 小時）才判定；實際壽命 = 設定值 + JWT 1h
- ⚠️ **專案層級設定，hope.huangxi.info 同步生效**（兩站會員都會每天被要求重登），Jason 已知情同意
- 回滾方式：Dashboard 同頁清空兩欄位即可；程式端 `src/proxy.ts` → `updateSession()` 與此設定相容，零改動

### ⏳ 待驗收（下次開工先確認）
0. **session 逾時實測**：(a) Jason 確認 Dashboard 兩欄位已存檔（若被要求升 Pro 則改走 cookie maxAge 方案）；(b) 正式站登入 >1 小時後訪問 `/dashboard` 應仍正常（活躍刷新沒被誤殺）；(c) 隔天 >24h 再訪問應被導回 `/login`；(d) hope 站抽驗登入無異常
1. **htc621010 等 QBC 老會員**：登出重登後應能看 6/6（force-dynamic 已修，資料庫確認其 Enrollment 在、id 一致、課程上架中）
2. **會員列表「開通課程」綠色按鈕**：勾會員→開通課程→用 course schema 查 Enrollment 確認寫入
3. **RBAC**：指派一個測試帳號為總教練/操作人員，登入驗證權限分級

### 📋 472 位學員大批匯入——執行順序（2026-07-25 規劃，動手前照做）

> 情境：一次匯入 472 位名單＋email 寄帳密，預估 60 分鐘內約 200 人湧入。
> 流量本身無虞（Vercel/pgbouncer 遠低於負荷），瓶頸全在信件額度與匯入超時。

1. **升級 Resend 方案**——免費 100 封/天，472 封帳密信必爆（HANDOFF 既有地雷）；忘記密碼信同吃此額度
2. **調高 Supabase Auth email rate limit**（Dashboard → Authentication → Rate Limits，預設約 30 封/小時 → 建議 150/小時）——防湧入期間忘記密碼信被擋「操作太頻繁」；專案層級但調高對 hope 站無害
3. **分 2-3 批匯入會員（每批 150-200 筆）**——批次匯入逐筆打 Auth API（0.3-0.5s/筆），472 筆一次跑恐撞 Vercel 300s timeout；冪等可續跑（已建立自動跳過，同名單重貼即續）。順便匯入專區會籍＋批次開通課程
4. **群發帳密信**，信內附「無法登入請點忘記密碼」＋ https://course.huangxi.info/forgot-password （後台代建帳號 email_confirm=true，可直接登入/直接走忘記密碼，全流程已實測）
5. **開放學員進站**

相關結論（2026-07-25 查證）：先匯入會籍再點邀請碼註冊不會出錯（signUp 擋已註冊、redeemInvite 冪等）；唯一陷阱＝學員用**不同 email** 註冊會產生第二筆會籍且 Enrollment 不會跟過去——已匯入開通者勿再發邀請連結，或註明務必用登記 email。

## 📌 待辦（依優先序）

0. **觀看影片累積時長**（用戶要做、方案已設計）：LessonProgress 表 + 播放頁 YouTube IFrame API 埋點算實看秒數 + 進度回報 API + 後台顯示（約 1.5-2 人日，純 ADD）
0.5. **P1–P3 其餘 ~25 項**（workflow 報告，完整清單在 /private/tmp 的 wd06dc3dc.output，或重跑）：越權改密碼防護、結帳冪等、免費課 total=0、open redirect、課程排序並發等

1. **hope 站註冊回歸測試**：Confirm email 是專案層級開關（已開啟），hope 站新註冊也會被要求驗證 Email——hope 端若沒處理確認連結要把開關關回（course 站已實測 OK，hope 站尚未測）
2. **與 QBC 站協調**：Recovery 模板已改 `{{ .RedirectTo }}` 格式，hope 站 reset 頁相容性回歸測試
2.5. **三分頁正式內容**：量子講師群/知識專區/講座邀約目前是籌備中佔位頁（共用 `src/components/site-page-shell.tsx`），待提供文案/圖片後實作
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
- **群發信額度**：Resend 免費方案 100 封/天、3,000 封/月（含 Auth 信），會員已 136+ 人，**對全部會員群發一次就超過日上限**（部分會失敗）——常態群發前建議升級 Resend 方案；排程群發的當天避免大量驗證信
- **電子報排程**：寄出名單以寄出當下為準（ALL/GROUP 動態解析、MANUAL 用存檔名單）；cron 原子認領防重複寄；測試方式見 git log `62ea8db`（空 RESEND_API_KEY 跑本機 dev + curl cron）
- **初始密碼備查（MemberPassword）**：存管理員設定的明碼，僅後台顯示。是使用者明確要求的取捨——Auth 真實密碼不可逆，學員自改後此表不同步
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
