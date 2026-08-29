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

## ⚠️ `"use server"` 檔案只能匯出 async 函式

`src/actions/*.ts` 匯出常數／同步函式（型別除外）會讓**整個路由群組一載入就整頁失敗**：
`A "use server" file can only export async functions, found object.`

**這項檢查在執行期才做，`pnpm tsc` 與 `next build` 全都會過**——2026-08-26 就是這樣
把錯誤送上正式站的。常數請放 `src/lib/`（`email/audience.ts`、`sms/audience.ts` 就是為此獨立）。

`pnpm build` 第一步會跑 `scripts/check-server-actions.ts` 擋下；單獨檢查用 `pnpm check:actions`。

## 重要概念區分

- **MailGroup**（名單群組）= EDM 電子報寄信名單
- **Enrollment**（觀看權限）= 能不能看課程
- 兩套獨立、互不影響；加名單群組不會開通課程

## 課前通知（場次名單一次匯入，兩個模組共用）

訂單匯進**場次看板**後，同一份 `SessionSignup` 同時餵 EDM 與簡訊，名單於**送出當下**解析
（發完才報名的人下次自動涵蓋；已延期到別場的不收原場次通知）。

- EDM `audienceType=SESSION`、簡訊 `audienceType=SESSION`，欄位皆為 `sessionIds`
- **EDM 的 `messageType`**：`MARKETING`（預設，退訂名單全擋）/ `NOTICE`（履約通知，
  只擋 BOUNCE 與 COMPLAINT——退訂電子報不等於放棄付費課程的上課通知）。
  只有場次／手動名單／選取會員可標 NOTICE，見 `NOTICE_ALLOWED_AUDIENCES`
- **上課連結**（線上課）：場次設 Zoom 連結後自動配 4 位**上課碼**，學員憑碼在 `/live` 索取。
  簡訊／EDM 內文用 `{code}` 變數自動帶入該場次的碼
- 場次卡片的「發課前通知」帶 `?session=<id>`，對方頁面自動勾好場次並填好草稿

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
pnpm check:actions                    # 檢查 "use server" 檔案的匯出（build 也會跑）

# 以下會寫入資料庫，只能對本機 localhost 跑
npx tsx --conditions=react-server scripts/test-live-access-db.ts        # 上課碼閘門 29 項
npx tsx --conditions=react-server scripts/test-broadcast-notice-db.ts   # EDM 退訂分流 12 項
npx tsx --conditions=react-server scripts/test-edm-delivery.ts          # EDM mock provider／跟進名單
npx tsx --conditions=react-server scripts/test-session-notice-db.ts     # 課前通知「未通知名單」11 項
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
src/lib/email/dispatch.ts     EDM 名單解析與寄送（filterUnsubscribed 是退訂分流的唯一漏斗）
src/lib/email/followup.ts     EDM 跟進條件（只從 provider ACCEPTED 母集合解析）
src/lib/sms/dispatch.ts       簡訊名單解析與發送（對照 email/dispatch）
src/lib/class-notice.ts       課前通知草稿（場次 → 簡訊／EDM 內容）
src/lib/live-auth.ts          /live 上課碼閘門（HMAC token，與 /board 網域分離）
src/app/live/                 學員憑上課碼索取 Zoom 連結
src/actions/student-history.ts 學員記錄卡匯入（upsertStudent：姓名不同＝不同人，絕不併卡）
src/lib/student-course.ts     標準課程 kind/level 標籤（課名歸戶）
src/lib/student-segment.ts    分眾圈人查詢（上過 X 未上過 Y → MailGroup 快照）
prisma/schema.prisma          資料模型（course schema only）
```

## 學員資料庫（/admin/students）

- **記錄卡**：手機是識別鍵；`/admin/students` 輸入電話查上課史
- **課名歸戶**：`/admin/students/courses`——訂單課名原文 → 27 個標準課程
  （`CanonicalCourse` + `StudentCourseAlias`，完整原文比對）。新場次的新課名會列「未歸戶」待指派
- **分眾圈人**：`/admin/students/segments`——條件圈人存成 MailGroup 快照，寄信走既有 EDM 群發
- **同行者鐵則**：訂購人常幫同行者填自己的電話/信箱。`upsertStudent` 一律「姓名不同＝不同人」，
  撞到別人手機就退回信箱路徑另建卡；**改這裡前先想清楚會不會把兩個人併成一張卡**

## git 注意

專案含 `[slug]`、`(auth)` 括號目錄；括號路徑要加引號（zsh glob 危險）。
**Jason 常同時開多個 session 動同一個 repo**：commit 前先看 `git status`，
只 add 自己改的檔（`git add "src/app/(admin)/..."`），別用 `git add -A` 掃進別人的在途工作。
