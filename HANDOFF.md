# HANDOFF — 線上課程學習平台（希望學院）

> 工作交接文件。每次告一段落更新此檔，下次開工先讀這裡。
> 最後更新：**2026-08-30（場次報名接平台金流＋自動新舊生定價＋訪客免註冊購課全數上線；
> 0919 冷名單 EDM 第一封已發。當日細節見 WORKLOG 2026-08-30）**
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

## 📋 下一階段待辦

- [ ] **EDM 影片行銷／階段式影片漏斗**：影片內容以 YouTube 不公開或 Vimeo 嵌入平台頁面，平台僅保存標題、封面、說明、嵌入連結、觀看權限與上下架時間；EDM 顯示封面＋播放按鈕導向指定頁。
  - 第一版：公開／Email 解鎖／登入會員／訂閱會員四種觀看權限，並以 EDM 點擊與影片頁瀏覽做分眾。
  - 第二版：串接播放器觀看進度，實作「看第 1 支 → 寄第 2 支 → 課程轉換」的自動化流程。
  - 潛在名單可用 YouTube 不公開；付費學員與訂閱內容優先 Vimeo 並設定網域嵌入限制。

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

**2026-07-25 晚（電子報寄送強化——470 筆世華會進階課通知的前置工程）**
- [x] **per-recipient 失敗記錄**：`EmailBroadcast.failedRecipients Json?`（[{email,name?,reason}]）+ `resendOfId`（補寄來源軟連結），migration `20260726090000_broadcast_failed_recipients`（手寫 SQL、本機驗證、grep 乾淨）
- [x] **一鍵補寄失敗者**：明細頁失敗名單區塊（email+原因）+ 紅色「補寄失敗者（N）」按鈕 → `resendFailedBroadcastAction`：開新 MANUAL 紀錄（audienceLabel 標補寄來源、resendOfId 回鏈）重用 executeBroadcast；原紀錄 failedRecipients 收斂為仍失敗子集（sentCount/failedCount 凍結）；併發防護（同源 SENDING 中擋重複點）
- [x] **429/5xx retry + backoff**（broadcast.ts）：每批最多 3 次嘗試，429 尊重 Retry-After（上限 10s）、否則 2s→4s 指數退避；網路錯誤/timeout（AbortSignal 15s）同樣重試；其他 4xx 不重試；批間延遲 600ms 守 Resend 2 req/sec
- [x] **修 claimedAt bug**：立即群發建紀錄補 `claimedAt`（原本 cron 的「SENDING 且 claimedAt=null → FAILED」回收會誤標進行中的立即寄送）
- [x] broadcast 三頁 + cron route 加 `maxDuration = 300`
- [x] 本機驗證全過（空 key 測法 + mock Resend 4010 埠）：到期排程 FAILED+逐筆失敗名單、進行中 SENDING 不被誤動、卡死 SENDING 回收、429→等 1s→500→等 4s→成功的退避時序、3 封全寄出
- 📋 **470 筆群發 SOP**：CSV 匯入名單群組 → 測試寄送給自己 → 正式群發 → 明細頁看失敗名單一鍵補寄 → 剩餘真退信（打錯/停用信箱）輸出走 LINE 群個案催辦。Resend 已升級付費方案；群發當天若逢註冊潮（Auth 信共用額度）錯開時段較穩
- ⏳ 待正式站驗收：部署後用含假 email 的手動名單實測一次失敗→補寄流程（本機只驗到 action 以下的層，UI 送出鏈路要在正式站點一次）

**2026-07-25 深夜（電子報缺口補齊 Phase A：退訂/成效追蹤/webhook/草稿/排程編輯/分頁）**
- [x] **退訂機制**：`MailUnsubscribe` 表（email PK、source USER/BOUNCE/COMPLAINT）+ HMAC token（`src/lib/email/unsubscribe.ts`，UNSUBSCRIBE_SECRET）+ 公開退訂頁 `/unsubscribe`（確認按鈕+選填原因，冪等）+ RFC 8058 one-click（`/api/unsubscribe` POST + List-Unsubscribe headers）+ 信 footer 逐人退訂連結 + `resolveRecipients` 三路匯合統一過濾（`excludedCount` 回寫顯示「已排除退訂 N 筆」）；測試信不過濾
- [x] **開信/點擊/退信回流**：每封帶 `tags: broadcast_id` → `/api/webhooks/resend`（手動 svix 驗簽零依賴：HMAC+timingSafeEqual+timestamp ±5min；雙 tags shape 容錯）→ `BroadcastEvent` 表（唯一鍵天然去重=唯一開信/點擊）；bounced/complained 自動進退訂表；明細頁成效列（送達/開信%/點擊%/退信）、列表頁開信/點擊欄（groupBy 防 N+1）
- [x] **四小項**：排程/草稿編輯頁 `/admin/broadcast/[id]/edit`（BroadcastForm defaultValues + `updateBroadcastAction` updateMany 狀態守衛防 cron 撞寫）；寄送紀錄分頁（?page=，每頁 20）；草稿（status DRAFT、存草稿鈕 formNoValidate 只驗主旨、繼續編輯/刪除、cron 不撈）；明細頁預覽套範例變數（example@example.com/王小明）
- [x] 本機驗證全過：退訂頁正確/壞 token、one-click 200/400/冪等、cron 過濾退訂者（excluded=1、快照不含）、草稿不被 cron 撈、webhook 七情境（雙 shape/重放冪等/bounce 進退訂表/壞簽 401/過期 401/無 tags 忽略）
- ✅ **部署後設定（2026-07-25 已全部完成）**：
  1. ~~Vercel env `UNSUBSCRIBE_SECRET`~~ 已設（與本機 .env 同值）＋ redeploy，**正式站實測**：正確 token 進確認畫面、偽 token 擋「連結無效」
  2. Resend Domains **Open/Click Tracking**：Jason 操作 Resend Dashboard（webhook 已建，tracking 開關若未開請順手確認）
  3. ~~`RESEND_WEBHOOK_SECRET`~~ Jason 建好 webhook 後提供 secret，已設進 Vercel + 本機 .env + redeploy，**正式站實測**：無簽章 POST → 401、真 secret 簽章 → 200（無 tags 不寫庫）
  → 下一封群發信起：footer 退訂連結生效、開信/點擊/退信數據開始回流明細頁
  4. Click Tracking CNAME（`service68.huibang.com.tw → links1.resend-dns.com`，cyberdns.tw 後台）：初次驗證 failed 是 Resend 在 DNS 生效前搶跑，重按 Verify 即過
  5. ✅ **2026-07-25 Jason 實測確認：明細頁已看到開信、點擊數據**——退訂/補寄/成效追蹤全鏈路正式驗收完畢，470 筆世華會群發基礎設施就緒

**2026-07-25 世華會進階課通知正式群發（首次實戰，全成功）**
- [x] 名單：「世華會-0727-AI進階」群組，CSV 441 筆 → 413 唯一（28 檔案內重複自動剔除、0 格式錯誤，已與正式庫雙向 diff 核對零漏匯）；寄出時 416 筆（Jason 後續有加人）
- [x] **群發結果：416/416 寄出成功、0 失敗**；送達 405+、開信 27%+、退信 2
- [x] 退信 2 筆已查明：`carrieliujp@gmail.cim`（報名打錯字，.cim 無 MX，待個案要正確 email）、`linda-chuang@diet-u.com.tw`（公司信箱內容過濾擋信，建議改留個人信箱）；皆已自動進排除名單
- [x] 9 筆 Gmail 暫時延遲（deferred）＝ Gmail 對突增流量的信譽控管，Resend 自動重試最長 72h，會自動變送達——此為正常現象非 bug
- [x] **明細頁新增逐人投遞狀態**（ed93a56）：📮 退信名單（email+原因）＋ ⏳ 已寄出未回報送達名單（自動隨回報縮短），後台可自助查，不用查 SQL
- ⚠️ **正式 Supabase exposed schemas 已變**：只剩 public/graphql_public/elite（course 的 REST expose 被移除、elite 來歷不明疑似 QBC 端變動）→ 查正式 course 資料改走 Supabase MCP execute_sql；`elite` 是誰加的建議與 hope 站確認

**2026-07-25 深夜（Phase B：全站追蹤碼設定）**
- [x] **追蹤碼三欄位**（GA4 / Meta Pixel / GTM）：存 SiteSetting（`tracking:*` keys，零 migration）；後台「分頁管理」下方新增設定區（僅 admin，`saveTrackingSettingsAction` 格式嚴格驗證——ID 會內插進 inline script，防呆防注入；清空=停用）
- [x] **前台注入** `src/components/tracking-scripts.tsx`（root layout 條件渲染）：/admin 路徑一律不載；GA4 `send_page_view:false` + Pixel init 不自動 PageView → 統一由 PageViewTracker 在路由切換發送（防重複計數；useSearchParams 包 Suspense）；GTM 含 noscript iframe、Pixel 含 noscript img
- [x] **註冊完成轉換事件**：register 成功畫面 `TrackSignUpOnce`（gtag sign_up / fbq CompleteRegistration / dataLayer push）；Confirm email 關閉時的 redirect 路徑不埋（正式環境 Confirm 開啟不會走到）
- [x] headless browser 實測：gtag/fbq 函式存在、dataLayer 有 config+event、SPA 路由切換 page_view 正確 +1；本機測試 ID 已清
- 📋 **啟用方式**：後台 /admin/settings 填入正式 GA4（G-…）/ Pixel（數字）/ GTM（GTM-…）ID 即生效，不用重新部署

**2026-08-04〜05（三個工作日夜的大批功能，HANDOFF 當時未記，此為 git log 補記，全數已部署）**
- [x] **課程場次報名看板**（`/board` 憑 4 位碼唯讀、60 秒自動更新、登入時效 N 小時強制過期）：後台上架場次＋上傳 1shop 訂單自動歸類；對不到關鍵字改詢問管理員歸類（不再默默排除，`b78bc64`）；手動新增報名（電話/現金單，新生/舊生標記）；新生/舊生人數（產品名含「複訓」判別）
- [x] **講座報名系統**（`/webinar/[slug]`）：訪客留姓名+email 索取講座連結信、自動進 EDM 名單群組；DM 圖直傳、會議 ID/密碼/補充資訊自動入信、{name}/{link} 變數；首頁「近期講座」區塊導流；防呆三層（網域打錯偵測/蜜罐/60 秒限流）——⚠️ 蜜罐欄位曾因名為 website 被 autofill 誤殺真人（jyuli780 個案），已改名 `hp_extra_note`
- [x] **簡訊模組第一階段**（`/admin/sms`，dry-run 架構未接簡訊商）：上課提醒、手機正規化（09XXXXXXXX，可疑一律拒收不猜）、SmsOptOut 分流（行銷/履約分開）、花費防線（單次/每日上限擋在 execute 層、金額存分）；架構文件 `docs/sms-module*`
- [x] **時區修正**（`db693e0`）：formatDate 全面帶 Asia/Taipei（Vercel UTC 環境下曾全部少 8 小時）；1shop 匯入日期明確補 +08:00
- [x] **後台導覽重整**：頂列 11 項收成 5 分組；講座拆「查看場次/建立講座」；總覽加場次/講座報名動態卡
- [x] **自訂前台頁面**（`/p/[slug]`，CustomPage 表）：分頁管理可自建頁面（標題/內文/多圖），navbar 自動掛載；內文用 RichText 同 EDM 語法
- [x] **EDM 發送對象可複選名單群組**（`27277a1`，groupIds 陣列＋回填 migration）：跨群組去重只寄一次、人數試算與寄出同一條解析路徑；模組文件 `docs/edm-module.md`
- [x] **企業包班**：前台 `/corporate` 諮詢表單（蜜罐/防重複入庫/管理員通知信+自動回覆）＋後台 `/admin/corporate` 名單管理（狀態/備註）＋導覽/首頁 CTA 曝光（SITE_PAGES key `corporate`）
- [x] 會員搜尋同時掃名單世界（未註冊 email 灰色區塊現形）；批次開通「查無會員」存底待開通、註冊當下自動認領

**2026-08-06（講座索取信寄送狀態追蹤，`7de9e99` 已部署）**
- [x] WebinarRequest 加 `deliveryStatus/deliveryDetail/deliveryAt`（migration 已上正式庫，舊資料 null 不回填）；寄信帶 `webinar_id` tag → Resend webhook 回流更新（狀態只升不降）
- [x] 後台名單狀態標籤＋卡片退信/失敗計數；報名成功頁輪詢 5 秒×2 分鐘（送達綠勾/退信提示改地址）；公開查詢端點防列舉（僅回報 15 分鐘內有寄送動作的紀錄）
- ⏳ 驗收：下次真實索取時看後台狀態標籤是否亮起（webhook 沿用 7/25 建的同一 endpoint，無需新設定）

**2026-08-06 深夜（EDM 圖文編輯器升級，`b21c36a` + lint 修復 `8c59471`）**
- [x] **新排版語法**（EDM 信件與自訂頁 RichText 同一套）：`**粗體**`、`## 標題`（獨立一段）、`---`（獨立一段＝分隔線）、`![說明](網址)` 全幅圖片；舊語法（變數/自動連結/`[按鈕](網址)`）不變，舊信件內容完全相容
- [x] **渲染核心抽共用**：`src/lib/email/render-content.ts`（純函式）——信件 HTML 與後台即時預覽同一條路徑；`broadcast.ts` re-export，呼叫端零改動；防注入維持 esc() 單一入口（圖片/按鈕先抽 placeholder→esc→粗體→自動連結→回填，順序不可調換）
- [x] **群發表單工具列**：粗體（選取即包）/標題/分隔線/按鈕/圖片/即時預覽；預覽套品牌信外框＋範例變數，textarea 維持非受控（鏡像 state 供預覽）
- [x] **內文圖片直傳**：沿用簽名 URL 流程（新 `broadcast` prefix），上傳完自動插入語法
- [x] 講座信/企業包班信共用 buildBroadcastHtml 自動獲得新語法；自訂頁表單 placeholder 同步更新
- [x] 驗證：`scripts/test-edm-render.ts` 26 項（回歸/注入/新語法/邊界）＋ RichText SSR 7 項全過；lint 0 error（順手修掉講座功能遺留的 2 個 react-hooks lint error）、build 過
- ⏳ 驗收：後台 /admin/broadcast 實際操作工具列＋上傳一張圖＋寄測試信給自己看版面
- 📋 EDM 候選優化（2026-08-06 排序）：逐人成效明細（半天）＞範本庫管理頁（半天）＞自動化系列信（2天）＞名單健康管理（1天）＞A/B 主旨（1.5天）＞成效儀表板（1天）

**2026-08-08（資安修復日：SECURITY_FIX_TODO 清單 6 項，P0-1 依 Jason 決定跳過）**
- [x] **P0-2 密碼重設越權**：bulk/單筆重設改 `requireFullAdmin`（operator 不可重設）＋ server 端逐筆驗 profile（拒絕 admin/本人/查無，不信前端 userIds）＋ 新表 `AdminAuditLog` 稽核（不記密碼）＋ 批次回報成功/拒絕/失敗統計；重設按鈕僅 admin 顯示、`/admin/members/inactive` 改 `pageGuardFullAdmin`
- [x] **P0-3 升版**：Next 16.2.7→16.2.12、React 19.2.4→19.2.8、eslint-config-next 同步（SSRF/RSC DoS 公告清除）
- [x] **P1-4 xlsx 換裝**：`xlsx@0.18.5`（prototype pollution/ReDoS）→ exceljs 4.4.0；CSV 走獨立 RFC4180 parser；magic bytes 判型（舊版 .xls 拒收）；2 萬列/60 欄/單格 2000 字上限；`scripts/test-order-import.ts` 14 項全過。pnpm overrides 收 transitive（brace-expansion/js-yaml/postcss/uuid→11.1.1/sharp→0.35.0），audit 只剩 tsx→esbuild 1 low（dev-only）
- [x] **P1-5 看板登入強化**（維持 4 位數字）：`BOARD_SESSION_SECRET` 獨立必填（≥32 字、無 fallback、缺漏安全失敗）；token `v1.exp.nonce.HMAC-SHA256` + timingSafeEqual；新表 `BoardLoginThrottle` DB 共享限流（同 IP 錯 5 次鎖 15 分、全域 10 分 100 次冷卻 60 分＋console.error 告警、成功重置）；IP 只信 x-real-ip/x-vercel-forwarded-for；時效上限 720→24h、預設 8h。**Vercel production+preview 已設 secret（與本機 .env 同值）**
- [x] **P1-6 結帳競態**：`Order.checkoutKey`（nullable unique，PENDING=`userId:courseId`、離開 PENDING 清 null）→ 併發下單 DB 層擋 P2002，migration 有回填；PENDING 逾 2h 於下次結帳 lazy 轉 EXPIRED；orderNo 改 crypto randomBytes 20 字元（原時間戳可猜號）；金流表單失敗轉 FAILED 釋放鍵；webhook PAID/FAILED 同步清鍵
- [x] **P2-7 安全標頭**（next.config.ts）：nosniff/Referrer-Policy/Permissions-Policy/X-Frame-Options DENY/HSTS/CSP `frame-ancestors 'none'` 立即阻擋；**完整白名單 CSP 掛 Report-Only 觀察中**（Supabase/YouTube/Slides/Canva/ECPay/GA4/Pixel/GTM），確認無誤殺後把 `REPORT_ONLY_CSP` 搬進 `ENFORCED_CSP` 即切換
- 3 個新 migration 全 additive（AdminAuditLog/BoardLoginThrottle/checkoutKey 回填）、grep 無 public./auth.；本機已套、正式庫由 Vercel build migrate deploy 自動跑
- ⚠️ **部署後影響**：看板既有 cookie 全失效（新 token 格式），現場要重輸一次 4 位碼；看板時效若原設 >24h 會收斂為 24h；operator 從此不能重設密碼（僅 admin）
- ⏳ 驗收：(a) 正式站看板重新登入一次；(b) 連錯 4 位碼 5 次應被鎖 15 分；(c) 訂單頁快速連點只產生一筆 PENDING；(d) curl -I 看 7 個安全標頭；(e) 觀察 CSP Report-Only 一兩週無誤殺後切正式
- 📋 未做（低優先遺留）：P0-1 明文密碼備查依 Jason 決定保留；tsx→esbuild 1 low（dev-only）；Vercel CLI 全域版本過舊建議 `pnpm add -g vercel@latest`

**2026-08-08 晚（簡訊模組接 MAAC Go 並正式上線）**
- [x] **MAAC Go adapter**（`src/lib/sms/provider/maacgo.ts`，漸強實驗室 sms.cresclab.com）：
  台灣三大電信直連、NCC 合規內建、NT$0.78/段。逐通 POST /sms/send（type=notification）、
  批 10 通間隔 1 秒、429/5xx 退避；錯誤轉中文（餘額不足/NCC 擋含原因/限速/號碼無效）；
  憑證缺漏不 throw 逐筆回失敗；sk_test_ 視為非 live 後台會標示。細節見 docs/sms-module.md §8.0
- [x] mock server 測試 17 項全過（`scripts/test-sms-maacgo.ts`，--conditions=react-server）
- [x] **正式站已切真發送**：Vercel production `SMS_PROVIDER=maacgo` + `MAACGO_API_KEY`（sk_live，
  已用唯讀端點驗證有效）＋ redeploy；正式庫 `sms:pricePerSegment` 已設 0.78
- ⚠️ **本機 .env 刻意維持 dryrun**（key 存了但 SMS_PROVIDER 沒開）——本機測真發送才暫時打開，防開發誤發
- 帳戶目前只有 NT$50 試用額度（約 64 段），大量發送前先到 MAAC Go 儲值；餘額不足會逐筆記「餘額不足」失敗
- ⏳ 驗收：/admin/sms 發一則給自己手機（後台紀錄應為綠色已發送、非紫色測試模式），對照 MAAC Go Dashboard 扣款
- 📋 之後可做：MAAC Go 送達 webhook（sms.delivered/failed，HMAC 驗簽比照 /api/webhooks/resend）回流逐筆狀態

**2026-08-08 深夜（會員手機必填＋個資法同意，已部署上線）**
- [x] **新表 `MemberProfile`**（course schema，additive，正式庫已套）：phone（normalizeMobile 格式）＋
  privacyConsentAt/Version——QBC 共用 profiles 唯讀不可動，補充資料存自己這邊；同意紀錄含版本可舉證
- [x] **註冊頁**：手機必填＋個資告知條款（可展開）＋必勾同意；先驗完才建帳號
- [x] **既有會員強制補填**：loginAction 無紀錄 → `/complete-profile?next=原目的地`；
  `(member)/layout.tsx` 閘門擋 dashboard/my-courses/learn/orders 直連；DB 失敗 fail-open 不鎖會員
- [x] **會員資料頁 `/dashboard/profile`**（新）：姓名/Email 唯讀、手機可改、同意紀錄＋條款展示；dashboard 加入口
- [x] 後台會員詳情加手機/個資同意欄（未補填標「下次登入會要求」）
- [x] 條款集中 `src/lib/privacy.ts` 版本化（**2026-08-08.v1**，Jason 已核可）；改版 bump 版本即可
- ⚠️ **蒐集機關必須寫「希望學院學習平台」**——曾誤植黃璽理財被 Jason 糾正，本專案對外文案禁用黃璽品牌
- ⚠️ **上線後所有既有會員（450+）下次登入會被要求補填**——若學員反映，屬預期行為；
  近期大量登入前（開課/講座）建議先在 LINE 群預告
- 已知取捨：`/zone/[slug]` 專區瀏覽頁不在閘門內（看影片的 /learn 有擋、登入導向也會強制）
- 正式站已驗證：註冊頁含手機/條款欄位、/complete-profile 200、migration 已套、無品牌誤植字樣

**2026-08-08 深夜之二（1shop 訂單回填會員手機，已部署）**
- [x] **後台 `/admin/members/phone-import`**（會員管理右上「📱 訂單回填手機」，editor 可用）：
  上傳 1shop 訂單檔（沿用 parseOrderFile 的 magic bytes/上限防護）→「顧客信箱」對會員
  （getProfilesByEmails 大小寫不敏感分批查）→ 回填「顧客電話」到 MemberProfile
- [x] **合規邊界**：只寫 phone、絕不代填同意——`MemberProfile.privacyConsentAt/Version` 改 nullable
  （migration `20260815100000`，正式庫已套），「補齊」定義改為**有手機且有同意**；
  回填會員登入仍走補填頁但手機已預填（畫面註明來源），勾同意即完成
- [x] **覆蓋原則**：會員自行補齊過（有同意）一律不動，號碼不同列入報告 conflicts 表人工判斷；
  同 email 多筆訂單取建立日期最新；市話/格式錯誤不猜、計數呈現；重複上傳冪等
- [x] 查核報告：總列數/有效 email＋手機/對到會員/回填數/略過原因/對不到會員 email 名單（前 20）
- ⏳ Jason 將實際上傳訂單檔跑回填；⚠️ 本機 dev DB 尚未套此 migration（下次本機開發前跑 migrate deploy）

**2026-08-08（平行線產出：模組化規劃稿，僅文件、未動程式）**
- 📐 **`docs/MODULARIZATION_PLAN.md`**：全專案功能模組化計畫（modular monolith，非微服務）——
  16 個業務模組（identity/access-control/course-catalog/learning-access/commerce/membership/
  member-operations/zones/sessions-board/webinars/corporate-inquiries/email-marketing/
  sms-marketing/site-content/media-storage/platform），每模組要有 `docs/modules/<name>/模組架構.md`
- 核心規則：一表一 owner 模組、跨模組只走 `index.ts` 公開出口、SDK 隔離在 infrastructure adapter、
  `src/app` 只當薄 adapter；依賴方向與禁止清單見計畫 §7
- 四階段：Phase 0 文件骨架（先寫現況不搬程式）→ P1 platform/email/sms/identity/access-control →
  P2 交易與學習流程 → P3 營運功能（拆 admin.ts）→ P4 強制邊界（lint 規則+CI 檢查）
- 建議第一批交付：16 份文件骨架＋4 份現況文件＋模組索引；第一個搬移示範選 email-marketing
- 現況基準文件：`docs/ARCHITECTURE.md`（同日建立）
- ⚠️ 風險控制已明訂：禁止大爆炸重構、一 PR 一模組；**執行前與各開發線協調**（此 repo 多線並行，
  搬檔期間其他線的 feature 開發會大量衝突，建議排空檔期集中做或凍結窗口）
- 狀態：規劃稿待 Jason 確認排程；尚未建立任何 `src/modules/` 或 `docs/modules/`

### ⏳ 待驗收（下次開工先確認）
0. **session 逾時實測**：(a) Jason 確認 Dashboard 兩欄位已存檔（若被要求升 Pro 則改走 cookie maxAge 方案）；(b) 正式站登入 >1 小時後訪問 `/dashboard` 應仍正常（活躍刷新沒被誤殺）；(c) 隔天 >24h 再訪問應被導回 `/login`；(d) hope 站抽驗登入無異常
1. **htc621010 等 QBC 老會員**：登出重登後應能看 6/6（force-dynamic 已修，資料庫確認其 Enrollment 在、id 一致、課程上架中）
2. **會員列表「開通課程」綠色按鈕**：勾會員→開通課程→用 course schema 查 Enrollment 確認寫入
3. **RBAC**：指派一個測試帳號為總教練/操作人員，登入驗證權限分級

### 📋 世華會 500 位初階學員上線計畫（2026-07-25 最終版，取代同日稍早的「472 匯入」版）

> 最終情境：LINE 群 500 位初階學員**沒有 email 名單**→ 只能走邀請碼自行註冊；
> 其中 470 位已報名進階課程，**有這 470 位的 email 名單**（= 對帳鍵）。
> 流量無虞（200 人/小時遠低於負荷），瓶頸在信件額度。

1. **初階課已設限時免開通**：`0720-online-aicourse` 的 `openToGroupUntil = 2026-09-08`（台北 23:59 止，正式庫已設）。期間內邀請碼註冊入專區即可看，**零手動開通**
   ✅ **2026-07-26 正式站全流程實測通過**（tjm55688 測試帳號刪除重註冊：邀請碼註冊→確認信→登入→專區「開放觀看中」→章節直接可看，全程無手動開通）
   📝 測試帳號清除紀錄（Admin API 刪 auth user，profiles 靠 CASCADE；course schema 手動清）：
   tjm55688@gmail.com（7/26）；huiniwang@gmail.com（7/26，**原有 4 門課開通紀錄一併刪除，Jason 確認不補回**——日後若有人問 huiniwang 課程消失，是這次刻意清除，非 bug；其名單群組 EDM 會籍保留）
2. **發邀請連結到 LINE 群**（`/register?invite=CODE`），公告務必註明：「**請用報名進階課程時填的 email 註冊**」（否則之後 470 名單對不到帳號）
3. **註冊潮前調高 Supabase Auth email rate limit**（Dashboard → Auth → Rate Limits，預設約 30 封/hr → 150/hr）：註冊確認信+忘記密碼信都吃這額度；500 人陸續註冊會超過。Resend 免費 100 封/天也可能爆，**發連結前先升級 Resend**
4. **進階課上架後**：批次開通貼 470 email 名單（≤500 筆限制內）。結果會列出「找不到帳號」的 email = 尚未註冊或換信箱者 → 群組催辦/個案處理
5. **9/8 到期後**：初階課自動恢復手動開通制。要讓誰續看 → 後台專區會籍名單（註冊後 email 都在裡面）批次開通初階課即可。到期前可在課程表單改日期延長

- 管理員（306465@gmail.com，role=admin）本來就免開通可看全部課程（learn/詳情頁既有 isAdminRole 例外）
- 邀請碼註冊防呆已驗證：已註冊 email 再註冊會被擋並導向登入；redeemInvite 冪等不產生重複會籍

**2026-07-25〜26（群發後個案查修日＋EDM 五功能＋寄信網域切換，全數已部署上線）**
- [x] **「沒收到信」個案 SOP 建立**：查 CSV 原檔 → MailGroupMember → recipients 快照 → BroadcastEvent → MailUnsubscribe → auth.users，逐層定位。今日查明的型態：不在原名單（4 筆補入）、送達進垃圾匣（GMX 德國信箱最嚴）、報名 email ≠ 慣用 email（周秦誼 gmail↔ntu、郭素綾 gmail↔gmx）、共用 email 第二報名人（7 組，已解 2 組：劉安立/劉芳君 geosun 公司信箱、賴雪嬌 hinet）
- [x] **名單解析容錯**（parseRows 重寫）：空白分隔、一行多 email、折行 email 自動接回、NBSP/零寬字元清除；逗號/Tab/密碼格式不變，8 情境實測全過
- [x] **EDM 五功能**：群組明細頁搜尋＋原地編輯成員；群發對象第 4 選項「選取會員」（搜會員勾選，底層沿用 MANUAL）；會員列表「企業專區」欄（琥珀=邀請碼/靛藍=手動徽章＋✕ 一鍵移出）；寄送紀錄「以此為範本」（帶入主旨/內文/課程，對象不帶防誤發）；註冊頁邀請碼欄位鎖唯讀（防學員誤改，今日實際發生 5 例）
- [x] **登入直達專區**：INVITE 來源會員登入後 redirect /zone/<slug>（多專區取最新、專區停用回一般流程）
- [x] **名單資料修正**：世華會 EDM 名單 421 筆（+劉安立/劉芳君 geosun、−共用 chenruby26；4 位缺席者已補）；專區白名單全量匯入（EDM 100% 覆蓋，zone 457 筆：INVITE 144/IMPORT 303/MANUAL 10）——未註冊者註冊即自動有專區資格，邀請碼降為便利入口非必要條件
- [x] **寄信網域切換 huibang.com.tw → course@huangxi.info**：Resend 驗證 huangxi.info（DKIM/SPF verified）＋ GoDaddy 加 4 筆 DNS ＋ DMARC p=quarantine ＋ EMAIL_FROM（.env+Vercel）＋ Supabase SMTP Sender（Jason 手動改，實測確認）。動機：GMX/hinet/公司信箱對「寄件網域≠連結網域」扣分（郭素綾 gmx 實例）。huibang.com.tw（公司官網）保留原驗證零影響；Resend 額度兩網域共用
- [x] **修 build 穩定性**：getTrackingSettings 查詢失敗降級空設定（root layout 每頁查 SiteSetting，pooler 瞬斷曾連炸三次 Vercel build P1001）
- [x] **補寄手法（無 UI 路徑時）**：直接 INSERT EmailBroadcast（status SCHEDULED、scheduledAt now、MANUAL manualRows、resendOfId 回鏈）→ cron 5 分鐘內走正式管線寄出（劉安立/劉芳君補寄 2/2 送達實證）
- ⏳ 共用 email 第二報名人剩 4 位未解（陳秀美/許秀珍/馮玉庭/黃小娟/李季洳）：等本人提供 email → 群組新增＋範本補寄
- ⏳ 7/27 行前通知：用「以此為範本」＋群組（421 筆）；黃秀森（andyboy7558355）已一鍵退訂會漏接，發送前確認是否誤按

## 📌 待辦（依優先序）

0. **0919 冷名單招生（進行中）**：報名頁已切平台金流（5880／複訓 2380，Jason 測試通過）。
   名單群組「量子沉睡舊生-0919台北」870 人已建；三封 EDM 草稿＋範本已建。
   **EDM1 已於 8/30 13:15 發出 926 封**（只導影片頁 /p/quantum-recap，純養溫）。
   - 下一步：**明天看 EDM1 成效**（開信率頭 48h 才穩），再發 EDM2（9/8 影片＋報名）、
     EDM3（9/15 收單）。EDM2 建議用「以此為範本」＋跟進條件只打未開信者
   - 有點擊的人可用「成效存群組」圈成熱名單打第二波
   - 20 位只有手機沒 Email 的量子舊生 EDM 打不到，要用簡訊補
0.1. **訪客購課實刷驗證**（功能 8/30 已上線，未經真錢驗證）：用 paytest-1twd ＋
   沒註冊過的信箱走一次，確認①帳號建出來②課程開通③**設定密碼信**收得到且版面 OK
   ④設完密碼看得到課。保底機制已備（建帳號失敗會存 PendingEnrollment，錢不會白收）
0.2. **ATM 取號虛擬帳號顯示**：場次訂單感謝頁只說「等待繳款」沒列帳號（課程訂單在
   /orders 有顯示，場次版沒做）；ATM 佔比高要補
0.5. ~~P1–P3 其餘 bug~~ **2026-08-29/30 已修 8 項**（open redirect/金流冪等/排序競態/
   重複付款防護等，見 docs/worklogs/2026-08-29-安全邏輯bug第二輪.md）。未修留檔：
   自助改密碼 reauthentication（兩站共用開關）、setUserPassword 守衛未下沉
0.8. **觀看影片累積時長**（用戶要做、方案已設計）：LessonProgress 表 + 播放頁 YouTube IFrame API 埋點算實看秒數 + 進度回報 API + 後台顯示（約 1.5-2 人日，純 ADD）。
   ⚠️ 6/14 的 PR #1 已關閉（與現行 main 衝突，且 migration 建表未帶 `course.` schema 前綴）
   ——**要重寫，不要復用那份 diff**

1. **hope 站註冊回歸測試**：Confirm email 是專案層級開關（已開啟），hope 站新註冊也會被要求驗證 Email——hope 端若沒處理確認連結要把開關關回（course 站已實測 OK，hope 站尚未測）
2. **與 QBC 站協調**：Recovery 模板已改 `{{ .RedirectTo }}` 格式，hope 站 reset 頁相容性回歸測試
2.5. **三分頁正式內容**：量子講師群/知識專區/講座邀約目前是籌備中佔位頁（共用 `src/components/site-page-shell.tsx`），待提供文案/圖片後實作
3. ~~正式金流~~ **已完成**：正式站走 PAYUNi（2026-08-29 起，1 元實刷驗證過），
   ezPay 發票自動開立；ECPay 降為 sandbox 備援。場次報名（/event）與課程頁
   （含訪客免註冊購課）都已接上
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
