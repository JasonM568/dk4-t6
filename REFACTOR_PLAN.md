# course-platform 改造計畫書：Auth.js 自建會員系統 → Supabase Auth

> 版本：v1.0（2026-06-12）
> 範圍：移除自建會員系統（User/Account + JWT），改接希望學院既有 Supabase 專案（qubjpayeopvscrgrvrci）的 Supabase Auth；課程資料全數遷入獨立 `course` schema；新增忘記密碼／重寄重置信功能與「希望學院」品牌化信件。
> 本文件由四份盤點報告（Auth 表面積、資料關聯、Supabase 整合模式、QBC 站台）整合而成。

---

## 0. 不可違反的前提

1. **絕不在程式或腳本中對正式 Supabase 做任何寫入測試、註冊測試帳號**。所有自動化測試走本機環境。
2. **Prisma 永遠只管 `course` schema**，絕不把 `public` schema 納入 Prisma migrate 管理（multiSchema 會把 QBC 正式表判為 drift，有 reset 風險）。`public.profiles` 一律以 supabase-js + secret key 唯讀查詢。
3. **不動 QBC（hope.huangxi.info）的程式與資料**。Supabase 專案層級設定（SMTP、信件模板、Redirect URLs、密碼規則）變更前必須先評估對 hope 站的影響，並照本文第 6 節的「兩站通用」設計操作。
4. `auth.users` 既有 87 位學員的密碼雜湊不被觸碰——course 站只是同一 Auth 專案的第二個前端，帳密天然通用。

---

## 1. 架構總覽（改造前 vs 改造後）

### 1.1 改造前（現況）

```
┌─ course.huangxi.info (Next.js 16) ─────────────────────────┐
│                                                            │
│  src/proxy.ts ── NextAuth(authConfig).auth（JWT 內嵌 role）│
│       │                                                    │
│  Auth.js v5（Credentials + 條件式 Google）                  │
│   ├─ src/auth.ts（PrismaAdapter + bcryptjs 比對）           │
│   ├─ src/auth.config.ts（jwt/session callbacks 注入 role）  │
│   └─ /api/auth/[...nextauth]                                │
│       │                                                    │
│  本機 PostgreSQL（public schema，Prisma 全管）              │
│   ├─ User（cuid id、passwordHash、role USER/ADMIN、         │
│   │        totalSpent / coursesBought / currentTierId）     │
│   ├─ Account（Auth.js OAuth）                               │
│   └─ MembershipTier / Course / Lesson / Order / OrderItem / │
│      Payment / Enrollment（userId → User.id FK）            │
└────────────────────────────────────────────────────────────┘
```

### 1.2 改造後（目標）

```
┌─ Supabase 專案 qubjpayeopvscrgrvrci（兩站共用）─────────────────────┐
│                                                                    │
│  auth schema（GoTrue 管，誰都不碰）                                  │
│   └─ auth.users：87 位學員 + 未來新註冊（uuid 主鍵）                   │
│        └─ trigger on_auth_user_created → handle_new_user             │
│                                                                    │
│  public schema（QBC 管，course 站唯讀）                              │
│   └─ profiles：id(uuid)/display_name/email/role(student|admin|       │
│                coach|master|tester)/nickname …                       │
│                                                                    │
│  course schema（本專案 Prisma 獨佔，?schema=course）                  │
│   ├─ MemberStats（userId uuid PK、totalSpent、coursesBought、         │
│   │              currentTierId → MembershipTier）★新表                │
│   ├─ MembershipTier / Course / Lesson / Order / OrderItem /           │
│   │  Payment / Enrollment                                            │
│   │   └─ Order.userId / Enrollment.userId = auth.users 的 uuid        │
│   │      （純欄位 @db.Uuid，無 FK——auth 在另一 schema）                │
│   └─ _prisma_migrations（建在 course schema 內）                      │
└────────────────────────────────────────────────────────────────────┘
          ▲ Auth API（GoTrue）            ▲ 5432 direct（migrate）
          │ signInWithPassword /          │ 6543 pgbouncer（runtime）
          │ signUp / resetPasswordForEmail│
┌─ course.huangxi.info (Next.js 16) ─────┴───────────────────────────┐
│  src/proxy.ts ── @supabase/ssr updateSession（cookie 刷新 +         │
│                  getClaims 驗登入；admin 角色留給 layout 二次驗）     │
│  lib/supabase/{client,server,proxy,admin}.ts（四個 client 工具）     │
│  (auth)/login、register、forgot-password、reset-password             │
│  /auth/confirm（token_hash + verifyOtp 的 Route Handler）            │
│  role 判斷：profiles.role（admin → 後台；其餘 → 一般會員）            │
└────────────────────────────────────────────────────────────────────┘

┌─ hope.huangxi.info（QBC，不動）─ 同一 Auth 專案，同帳密通用 ─┐
└──────────────────────────────────────────────────────────────┘
```

### 1.3 關鍵設計決策摘要

| 議題 | 決策 | 理由 |
|---|---|---|
| 會員等級狀態去向 | course schema 新表 `MemberStats`（uuid PK，lazy upsert） | 不污染 QBC 的 profiles；本機開發環境不斷裂；webhook 交易性保留 |
| userId 型別 | `String @db.Uuid`，無 FK | auth.users 在 auth schema，跨 schema FK 本機建不起來、官方也不建議 |
| proxy 的 role 檢查 | proxy 只驗「已登入」；admin 角色由 (admin)/layout + requireAdmin 查 profiles 二次驗證 | 避免 edge 層每 request 查 DB；Custom Access Token Hook 是專案層級設定會影響 QBC，本階段不用 |
| role 對映 | `admin` → 可進後台；`student/coach/master/tester` → 一般會員 | 最小權限原則；coach/master 若日後要進後台再加白名單即可（集中在一個函式改） |
| 讀 profiles | supabase-js + secret key（sb_secret_）server-only client | Prisma multiSchema 碰 public 對正式庫有毀滅性風險 |
| migration | 刪舊 init、重生全新 init | 正式 Supabase 從未套用過任何 migration，零風險；本機是 seed 可重建的測試資料 |
| 重置信流程 | 信件模板用 `{{ .RedirectTo }}?token_hash={{ .TokenHash }}&type=recovery` + 本站 /auth/confirm 用 verifyOtp | 避開 PKCE「必須同瀏覽器開信」限制；兩站共用一份模板 |
| admin 訂單頁 email | Order 新增 `buyerEmail` 快照欄位（下單當下從 session 取） | User 關聯消失後 email 無處 join；快照兼具稽核價值 |
| Google OAuth | 本次移除，不遷移 | 須在 Supabase 專案層級開 provider 且 identity linking 行為與現況不同，影響 QBC，留待後續獨立評估 |

---

## 2. 逐檔變更清單

### 2.1 刪除（D）

| 檔案 | 為什麼 |
|---|---|
| `src/auth.ts` | Auth.js 完整實例（PrismaAdapter + Credentials + bcrypt），整套退役 |
| `src/auth.config.ts` | edge-safe 設定（authorized/jwt/session callbacks），由 Supabase SSR 取代 |
| `src/types/next-auth.d.ts` | next-auth 模組型別擴增，套件移除後無意義 |
| `src/app/api/auth/[...nextauth]/route.ts` | Auth.js handlers 掛載點，Supabase Auth 不需要本地 auth API |

### 2.2 新增（A）

| 檔案 | 內容與理由 |
|---|---|
| `src/lib/supabase/client.ts` | `createBrowserClient(NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY)`，client component 用（reset-password 頁需要） |
| `src/lib/supabase/server.ts` | `createServerClient` + `await cookies()` 的 getAll/setAll 樣板；每 request 重建。匯出 `getAuthUser()` helper（包 `supabase.auth.getClaims()`，回傳 `{ id: claims.sub, email: claims.email }` 或 null），給所有 server component / action 統一取代 `await auth()` |
| `src/lib/supabase/proxy.ts` | `updateSession(request)` helper：createServerClient（讀 request.cookies、setAll 同時寫回 request 與 response）→ **立即** `getClaims()` → 未登入訪問保護路徑導 /login → 原樣回傳帶 cookie 的 response |
| `src/lib/supabase/admin.ts` | `import 'server-only'`；用 `SUPABASE_SECRET_KEY` 建 admin client。匯出 `getProfileRole(uuid)`（查 `profiles.role`）與 `listProfiles()`（後台會員列表用）。secret key 絕不進 client bundle |
| `src/lib/auth/role.ts` | role 對映單一真實來源：`const ADMIN_ROLES = ['admin'] as const; export function isAdminRole(role: string \| null)`。日後 coach/master 要開權限只改這裡 |
| `src/app/(auth)/forgot-password/page.tsx` | 忘記密碼頁（見第 5 節） |
| `src/app/(auth)/reset-password/page.tsx` | 設定新密碼頁（client component，呼叫 `updateUser({ password })`） |
| `src/app/auth/confirm/route.ts` | Route Handler：讀 `token_hash`/`type`/`next` → `verifyOtp({ type, token_hash })` → 成功 redirect 到 next（/reset-password），失敗導 /forgot-password?error=… |
| `prisma/migrations/<新>_init/` | 重生的全新 init migration（見第 4 節） |

### 2.3 修改（M）

| 檔案 | 改什麼 | 為什麼 |
|---|---|---|
| `prisma/schema.prisma` | 刪 User/Account/Role enum；Order.userId、Enrollment.userId 改 `@db.Uuid` 去 FK；新增 MemberStats；Order 加 buyerEmail | 見第 3 節最終版草稿 |
| `src/proxy.ts` | 改為 `export default async function proxy(request) { return updateSession(request) }`，matcher 五組路徑不變；移除 /admin 的 edge 角色判斷（只驗登入） | Next 16 proxy 跑 Node runtime，@supabase/ssr cookie 模式直接可用；role 檢查下放 layout |
| `src/actions/auth.ts` | 重寫四個 action：`loginAction`（signInWithPassword）、`registerAction`（signUp + metadata `{ display_name, nickname, role: 'student' }`、identities.length===0 判重複註冊）、`logoutAction`（signOut）、新增 `forgotPasswordAction`（resetPasswordForEmail，含 429 處理）。移除 bcrypt/prisma.user/銅卡掛載 | 密碼與帳號全交 GoTrue；profiles 由 QBC trigger 自動建立，本專案不建；metadata 對齊 hope 站讓 handle_new_user 建出一致 profiles |
| `src/app/(auth)/login/page.tsx` | 接新 loginAction；加「忘記密碼？」連結到 /forgot-password | 對齊 hope 站功能 |
| `src/app/(auth)/register/page.tsx` | 接新 registerAction；密碼規則改「至少 6 字元」；display_name 規則對齊 hope（至少 2 個中文字 `/^[一-鿿]{2,}$/`）；若 Confirm email 開啟，成功後顯示「請收確認信」而非自動登入 | 兩站同帳密規則必須一致，否則學員密碼在兩站行為不一 |
| `src/components/logout-button.tsx` | 接新 logoutAction（介面不變） | — |
| `src/components/navbar.tsx` | `await auth()` → `getAuthUser()`；顯示名改讀 user_metadata.display_name 或 email；admin 連結改 `isAdminRole(await getProfileRole(id))` | session 來源更換 |
| `src/app/(member)/dashboard/page.tsx` | session → getAuthUser()；prisma.user.findUnique → MemberStats.findUnique（含 currentTier）；無 stats 時顯示預設值（0 元、無等級） | User 表消失；MemberStats 是 lazy upsert，新會員可能還沒有 |
| `src/app/(member)/orders/page.tsx`、`orders/[orderNo]/page.tsx`、`my-courses/page.tsx`、`learn/[courseSlug]/page.tsx` | 只換 id 來源：`session.user.id` → `getAuthUser().id`（uuid），查詢與擁有權檢查邏輯不變 | userId 值換 uuid 即可 |
| `src/app/(shop)/courses/[slug]/page.tsx` | 可選登入改 getAuthUser()；折扣查詢 user.currentTier → MemberStats.currentTier | 等級狀態搬家 |
| `src/actions/checkout.ts` | 登入驗證改 getAuthUser()；折扣查 MemberStats；`order.create` 補存 `buyerEmail: user.email` | 等級搬家 + email 快照 |
| `src/app/api/payment/ecpay/notify/route.ts` | `tx.user.update`（累加 totalSpent/coursesBought）→ `tx.memberStats.upsert`；recalcTier 介面不變；**整段必須留在同一 `$transaction`** | 收入關鍵路徑，冪等（enrollment @@unique）與交易性不可破壞 |
| `src/lib/membership/tier.ts` | recalcTier 讀寫對象 prisma.user → prisma.memberStats（同樣吃 tx） | 等級引擎跟著搬 |
| `src/actions/admin.ts` | `requireAdmin`：改 `getAuthUser()` + `isAdminRole(await getProfileRole(id))` | role 來源更換 |
| `src/app/(admin)/admin/layout.tsx` | 同上的二次驗證（縱深防禦第二層保留） | proxy 已不查 role，這層變成 admin 唯一守門員，**不可省略** |
| `src/app/(admin)/admin/page.tsx` | `prisma.user.count()` → admin client count `profiles` | User 表消失 |
| `src/app/(admin)/admin/members/page.tsx` | 上半 Tier 規則編輯不動；下半會員列表改 `listProfiles()`（admin client 讀 profiles）+ 應用層拼 MemberStats（或 `prisma.$queryRaw` 跨 schema join，唯讀） | 採盤點報告方案 B：唯讀 profiles，一句查詢可排序；「不寫 public schema」列為鐵則 |
| `src/app/(admin)/admin/orders/page.tsx` | `include: { user: true }` 刪除；`o.user.email` → `o.buyerEmail` | User 關聯消失，不補會直接編譯失敗 |
| `prisma/seed.ts` | 刪 user upsert / bcrypt 段；保留 MembershipTier 與課程 seed；測試 enrollment/order 改用固定測試 uuid 常數（如 `TEST_USER_ID = '00000000-0000-4000-8000-000000000001'`） | 不能也不需 seed 使用者 |
| `scripts/reset-testuser.ts` | 以 email 查 user → 以固定測試 uuid 清 enrollment/order + 重置 MemberStats | 同上 |
| `scripts/test-purchase-flow.ts` | 同上：固定 uuid 走 下單→付款→enrollment→recalcTier，結尾驗 MemberStats | 同上 |
| `package.json` | 移除 `next-auth`、`@auth/prisma-adapter`、`bcryptjs`、`@types/bcryptjs`；新增 `@supabase/ssr`、`@supabase/supabase-js`、`server-only` | 見盤點報告 |
| `.env` / `.env.example` | 見第 7 節 | — |

### 2.4 不變

`scripts/test-ecpay.ts`（不碰 User）、`src/lib/db.ts`、`src/lib/payment/*`、`src/lib/format.ts`、(shop) 列表頁、Course/Lesson/OrderItem/Payment 模型與所有金流簽章邏輯。

---

## 3. Prisma schema 最終版草稿

```prisma
// 線上課程學習網站 — 資料模型（course schema 版）
// 金額一律用整數（新台幣元）。
// 會員身分在 Supabase auth.users（uuid），本 schema 不存任何密碼/帳號資料。

generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider  = "postgresql"
  url       = env("DATABASE_URL")          // …?schema=course（runtime，Supabase 走 6543 pooler）
  directUrl = env("DATABASE_URL_UNPOOLED") // …?schema=course（migrate 用，Supabase 必須 5432 direct）
}

enum OrderStatus {
  PENDING
  PAID
  FAILED
  EXPIRED
  REFUNDED
}

enum PaymentStatus {
  PENDING
  SUCCESS
  FAILED
  REFUNDED
}

// ── 會員統計（取代原 User 上的等級狀態欄位）──
// userId = Supabase auth.users.id（uuid）。lazy upsert：首次下單/付款時建立。
// 不建 FK：auth.users 在 auth schema，本機開發 PG 沒有該 schema。
model MemberStats {
  userId        String          @id @db.Uuid
  currentTierId String?
  currentTier   MembershipTier? @relation(fields: [currentTierId], references: [id])
  totalSpent    Int             @default(0) // 累積實付金額
  coursesBought Int             @default(0) // 累積購課數

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
}

// 等級門檻設定表（後台可調）
model MembershipTier {
  id               String @id @default(cuid())
  name             String // 銅 / 銀 / 金
  level            Int    @unique
  minTotalSpent    Int    @default(0)
  minCoursesBought Int    @default(0)
  discountPercent  Int    @default(0)

  members MemberStats[]
}

model Course {
  id          String  @id @default(cuid())
  slug        String  @unique
  title       String
  description String  @db.Text
  coverImage  String?
  price       Int
  isPublished Boolean @default(false)

  lessons     Lesson[]
  orderItems  OrderItem[]
  enrollments Enrollment[]

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
}

model Lesson {
  id          String  @id @default(cuid())
  courseId    String
  course      Course  @relation(fields: [courseId], references: [id], onDelete: Cascade)
  title       String
  youtubeId   String
  order       Int
  durationSec Int?

  @@index([courseId])
}

model Order {
  id          String      @id @default(cuid())
  orderNo     String      @unique // ECPay MerchantTradeNo（≤20 字元）
  userId      String      @db.Uuid // auth.users.id，無 FK
  buyerEmail  String? // 下單當下 email 快照（後台顯示與稽核用）
  status      OrderStatus @default(PENDING)
  subtotal    Int
  discount    Int         @default(0)
  total       Int
  tierAtOrder Int?

  items   OrderItem[]
  payment Payment?

  createdAt DateTime  @default(now())
  paidAt    DateTime?

  @@index([userId])
}

model OrderItem {
  id        String @id @default(cuid())
  orderId   String
  order     Order  @relation(fields: [orderId], references: [id], onDelete: Cascade)
  courseId  String
  course    Course @relation(fields: [courseId], references: [id])
  unitPrice Int

  @@unique([orderId, courseId])
  @@index([courseId])
}

model Payment {
  id          String        @id @default(cuid())
  orderId     String        @unique
  order       Order         @relation(fields: [orderId], references: [id])
  provider    String
  status      PaymentStatus @default(PENDING)
  amount      Int
  tradeNo     String?
  paymentType String?
  rawCallback Json?
  notifiedAt  DateTime?

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
}

// 已購買關係 — 「能不能看課程」的唯一真實來源
model Enrollment {
  id       String  @id @default(cuid())
  userId   String  @db.Uuid // auth.users.id，無 FK
  courseId String
  course   Course  @relation(fields: [courseId], references: [id])
  orderId  String?

  createdAt DateTime @default(now())

  @@unique([userId, courseId]) // 防重複授權 + webhook 冪等
  @@index([userId])
}
```

變更摘要：刪 `User`、`Account`、`Role` enum；新增 `MemberStats`、`Order.buyerEmail`；`Order.userId`/`Enrollment.userId` 改 `@db.Uuid` 並移除 relation；`MembershipTier.users` 改指向 `MemberStats`；其餘模型原封不動。**不開 multiSchema、不宣告任何 public schema 的 model。**

---

## 4. Migration 策略

### 4.1 現況確認

- 既有 migration 只有一個：`prisma/migrations/20260606142056_init/`，內含即將刪除的 User/Account/Role。
- **正式 Supabase 從未套用過本專案任何 migration**（目前只連本機 PG）→ 重置重生零風險。
- 本機資料皆為 seed 可重建的測試資料，cuid userId 與 uuid 不相容，不做資料對映、直接清空。

### 4.2 決策：重置重生全新 init（不疊加 drop migration）

```bash
# 本機（一次性）
# 1. 改 .env：DATABASE_URL / DATABASE_URL_UNPOOLED 加 ?schema=course
# 2. 換上新 schema.prisma
rm -rf prisma/migrations            # 刪舊 init（含 migration_lock.toml 一起重生）
pnpm prisma migrate dev --name init # 在本機 PG 的 course schema 重生全新 init
pnpm prisma db seed                 # 重灌 Tier/課程 seed
```

注意：`?schema=course` 會讓 `_prisma_migrations` 表建在 course schema 內；Prisma 會自動 `CREATE SCHEMA IF NOT EXISTS "course"`；OrderStatus/PaymentStatus enum 也建在 course schema，與 public 互不干擾。

### 4.3 正式 Supabase 的部署順序（上線階段才做）

1. 在 Vercel 設定 `DATABASE_URL`（6543 pooler + `?schema=course&pgbouncer=true`）與 `DATABASE_URL_UNPOOLED`（**5432 direct** + `?schema=course`）。migrate 必須走 directUrl——pgbouncer 跑不了 DDL advisory lock。
2. 既有 build script（`prisma generate && prisma migrate deploy && next build`）在首次部署時會於正式庫建立 course schema 與全部表。**這是本計畫唯一允許寫入正式庫的途徑**，且只建 course schema、不碰 public/auth。
3. 部署前先用 `prisma migrate diff --from-empty --to-schema-datamodel` 人工審閱將執行的 SQL，確認沒有任何 `public.` 或 `auth.` 字樣。
4. course schema 預設不被 PostgREST 暴露，正好隔離（不要去 Dashboard 把 course 加進 Exposed schemas）。

### 4.4 規則

- 未來所有 schema 變更一律 `migrate dev`（本機）→ code review SQL → `migrate deploy`（CI/Vercel）。
- 永遠不在正式庫跑 `migrate reset`、`db push`。

---

## 5. 忘記密碼／重寄重置信：頁面與流程設計

### 5.1 頁面與路由

| 路由 | 型態 | 職責 |
|---|---|---|
| `/forgot-password` | (auth) 頁 + server action | 輸入 email → `resetPasswordForEmail(email, { redirectTo: NEXT_PUBLIC_BASE_URL + '/auth/confirm' })` |
| `/auth/confirm` | Route Handler (GET) | 讀 `token_hash`、`type=recovery`、`next` → server client `verifyOtp({ type, token_hash })` → 成功 redirect `/reset-password`；失敗 redirect `/forgot-password?error=invalid_or_expired` |
| `/reset-password` | client component | 此時已有 session；新密碼 + 確認新密碼（≥6 字元，對齊 hope）→ `supabase.auth.updateUser({ password })` → 導 /dashboard。需同時容錯 `?code=`（exchangeCodeForSession）與 `#access_token` hash 兩種舊格式（比照 hope reset 頁），保證從 QBC 模板格式過來也能用 |

### 5.2 流程（happy path）

```
[忘記密碼頁] -- email --> resetPasswordForEmail(redirectTo=course站/auth/confirm)
      │（不論帳號存在與否，一律顯示「若帳號存在，重置信已寄出」→ 防帳號枚舉）
      ▼
[希望學院品牌信] 連結 = {{ .RedirectTo }}?token_hash={{ .TokenHash }}&type=recovery
      │（token_hash 模式不依賴 PKCE code verifier → 跨裝置/瀏覽器開信也能用）
      ▼
[/auth/confirm] verifyOtp(type=recovery, token_hash) → 建立 session
      ▼
[/reset-password] updateUser({ password }) → 完成，hope 站同組新密碼立即可用
```

### 5.3 重寄設計

- `auth.resend()` **不支援 recovery type**；重寄＝再呼叫一次 `resetPasswordForEmail`。
- 忘記密碼頁送出成功後進入「已寄出」狀態：顯示垃圾信提示 + 「重新寄送」按鈕，**前端 60 秒倒數鎖鈕**（對齊 Supabase 同一使用者冷卻期）。

### 5.4 Rate limit 與錯誤處理

| 情境 | 處理 |
|---|---|
| `over_email_send_rate_limit` / HTTP 429 | 讀 `Retry-After` 秒數，顯示「請於 N 秒後再試」，鎖鈕倒數 |
| token 過期/已用（verifyOtp 失敗） | /forgot-password?error=… 顯示「連結已失效，請重新申請」 |
| 信件連結被收件端 prefetch 吃掉 | 上線實測 Gmail/Outlook；若發生，改在 /auth/confirm 前加中介確認頁（按鈕觸發 verifyOtp）或改用 `{{ .Token }}` 6 位數 OTP |
| email 不存在 | 與成功相同文案（防枚舉） |
| 新密碼 <6 字元 | client + server action 雙重擋（zod） |
| server action 內所有 Supabase 錯誤 | 對應到使用者可讀的繁中文案，不外洩原始錯誤 |

---

## 6. 信件品牌化（希望學院）與自訂 SMTP 設定步驟

> 根因確認：未設自訂 SMTP 時，Supabase 內建 SMTP **只寄給專案 Team 成員**（其他人回 Email address not authorized）且每小時僅約 2 封——這就是現在重置信寄不出去的原因。設定自訂 SMTP 是專案層級，會同時修好 hope 站的信。

### 6.1 步驟總表（標注操作者）

| # | 步驟 | 操作者 | 說明 |
|---|---|---|---|
| 1 | 申請寄信服務（建議 Resend，或 SES/SendGrid）並完成寄件網域（如 `mail.huangxi.info`）的 SPF/DKIM 驗證 | **使用者**（需 DNS 權限） | 拿到 SMTP host/port/user/pass |
| 2 | **關閉寄信服務的 link/click tracking** | **使用者**（服務商後台） | tracking 會改寫連結導致 token 失效 |
| 3 | Supabase Dashboard → Authentication → Emails → SMTP Settings：填 host/port/user/pass、Sender email（如 `no-reply@mail.huangxi.info`）、**Sender name =「希望學院」** | **使用者**（Dashboard） | 專案層級，hope 的信同步換抬頭（正是想要的效果） |
| 4 | Auth → Rate Limits：核對並調整每小時寄信上限（自訂 SMTP 啟用後預設僅 30 封/小時）；同時核對 60 秒冷卻等當前實際值 | **使用者**（Dashboard） | 盤點報告的數字來自社群整理，以 Dashboard 為準 |
| 5 | Authentication → URL Configuration：**Site URL 不動**（hope 在用）；Redirect URLs 新增 `https://course.huangxi.info/auth/confirm`、`https://course.huangxi.info/reset-password`、本機 `http://localhost:3000/auth/confirm`、`http://localhost:3000/reset-password` | **使用者**（Dashboard） | 不加 allowlist，redirectTo 會被退回 hope 的 Site URL，造成跨站混淆 |
| 6 | 提供「希望學院」正式 LOGO 原始檔 | **使用者**（向業主索取素材） | QBC 站上只有 256px 黑圓白三角 favicon，無正式 LOGO。**拿不到時的後備方案**：信件 header 用文字字標——金色漸層（#D4AF37→#F5D77A）「HOPE」+「希望學院 HOPE Academy」，深色 #0A0A0A 背景，對齊 hope 站視覺 |
| 7 | LOGO 上傳到可公開存取的絕對網址（Supabase Storage public bucket 或網站 /public） | Claude 可備檔，**使用者**執行上傳 | 信件 `<img>` 需絕對網址；部分收件端擋外圖，文字後備要可讀 |
| 8 | Authentication → Email Templates → Reset Password：換成希望學院品牌 HTML 模板（Claude 產出 HTML，使用者貼上） | **使用者**（Dashboard）；Claude 產模板 | 關鍵：連結寫 `{{ .RedirectTo }}?token_hash={{ .TokenHash }}&type=recovery`，文案站台中性（「重設你的希望學院帳號密碼」）——一份模板兩站通用 |
| 9 | **與 QBC 站協調**：模板改用 RedirectTo 後，hope 的 reset 頁要能吃 `?token_hash=` 或 hope 端 redirectTo 改指向自己的 confirm 端點；上線前 hope 流程要實測走通 | **使用者**（協調）+ QBC 開發者 | 模板全專案只有一份，這是兩站耦合點中風險最高的一項 |
| 10 | 用真實外部信箱（Gmail/Outlook）實測兩站重置流程 | **使用者** + Claude 陪測 | 驗 SMTP、模板變數、prefetch 問題 |

### 6.2 模板可用變數備忘

`{{ .RedirectTo }}`（resetPasswordForEmail 傳入的 redirectTo）、`{{ .TokenHash }}`、`{{ .Token }}`（6 位數 OTP 備援）、`{{ .SiteURL }}`、`{{ .Email }}`、`{{ .Data }}`（user_metadata，可用 display_name 做個人化稱呼）。支援 Go Template 條件式。

---

## 7. 環境變數清單

### 7.1 本機 `.env`

```bash
# ── 資料庫（本機 PostgreSQL，course schema）──
DATABASE_URL="postgresql://user:pass@localhost:5432/course_platform?schema=course"
DATABASE_URL_UNPOOLED="postgresql://user:pass@localhost:5432/course_platform?schema=course"

# ── Supabase Auth（正式專案；本機開發直接連它做「登入」，但絕不跑寫入測試）──
NEXT_PUBLIC_SUPABASE_URL="https://qubjpayeopvscrgrvrci.supabase.co"
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY="sb_publishable_..."   # 新制金鑰（legacy anon 2026 年底淘汰）
SUPABASE_SECRET_KEY="sb_secret_..."                         # server-only，BYPASSRLS，絕不進 client

# ── 金流（不變）──
PAYMENT_PROVIDER="ecpay"
ECPAY_MERCHANT_ID="..."
ECPAY_HASH_KEY="..."
ECPAY_HASH_IV="..."
ECPAY_API_URL="..."

# ── 站台 ──
NEXT_PUBLIC_BASE_URL="http://localhost:3000"
```

移除：`AUTH_SECRET`、`AUTH_GOOGLE_ID`、`AUTH_GOOGLE_SECRET`。

### 7.2 Vercel（Production）

| 變數 | 值 | 範圍 |
|---|---|---|
| `DATABASE_URL` | Supabase 6543 pooler + `?schema=course&pgbouncer=true` | 加密 |
| `DATABASE_URL_UNPOOLED` | Supabase 5432 direct + `?schema=course` | 加密（build 時 migrate deploy 用） |
| `NEXT_PUBLIC_SUPABASE_URL` | `https://qubjpayeopvscrgrvrci.supabase.co` | 公開 |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | `sb_publishable_...` | 公開 |
| `SUPABASE_SECRET_KEY` | `sb_secret_...` | **加密、僅 server** |
| `PAYMENT_PROVIDER` / `ECPAY_*` | 正式金流參數 | 加密 |
| `NEXT_PUBLIC_BASE_URL` | `https://course.huangxi.info` | 公開 |

備註：金鑰一律用新制 `sb_publishable_` / `sb_secret_`（Dashboard → API Keys 產生）；若 Dashboard 只有 legacy anon/service_role，先建新制金鑰再填。

---

## 8. 測試與驗收計畫

### 8.1 可自動化（完全不碰正式 Supabase）

| 項目 | 方式 |
|---|---|
| 型別與建置 | `pnpm tsc --noEmit`、`pnpm build`（連本機 DB）——能抓出所有 user 關聯漏改（如 admin/orders 的 o.user.email） |
| migration 正確性 | 本機 `migrate reset` → `migrate dev` → seed 全綠；檢查 `_prisma_migrations` 與所有表都在 course schema |
| 購課全流程 | `scripts/test-purchase-flow.ts`（固定測試 uuid）：下單 → 模擬 ECPay notify → Enrollment 建立 → MemberStats 累加 → recalcTier 升級 → 折扣生效 |
| webhook 冪等 | 同一 notify 打兩次，Enrollment 不重複、MemberStats 不重複累加（@@unique 防線） |
| 測試資料重置 | `scripts/reset-testuser.ts` 清空後可重跑 |
| /auth/confirm 錯誤分支 | 帶無效/缺漏 token_hash 打本機端點，驗 redirect 到錯誤頁（verifyOtp 失敗路徑，不需真 token） |
| 未登入路由保護 | 無 cookie 請求 /dashboard、/admin 等五組路徑，驗 redirect /login（proxy 層，不需真帳號） |

### 8.2 人工 smoke test（用使用者本人帳號，唯讀為主）

> 原則：人工測試用使用者自己在希望學院的真實帳號（或請管理者提供一個既有測試帳號，QBC role 分布裡已有 tester），**不新建帳號**。

1. **登入/登出**：本機 dev server 用真帳號 signInWithPassword 登入 course 站 → navbar 顯示正確 → 登出。
2. **角色**：student 帳號訪問 /admin 被導走；admin 帳號可進後台（layout 二次驗證生效）。
3. **忘記密碼（上線前最關鍵）**：course 站發起 → 收到「希望學院」抬頭品牌信 → 手機開信（跨裝置驗 token_hash 流程）→ 改密碼 → **hope 站用新密碼登入成功**。
4. **重寄**：60 秒內重按被鎖、60 秒後重寄成功；超過小時限額時顯示正確文案。
5. **QBC 回歸**：hope 站自己的 forgot/reset 流程在模板更新後仍走得通（與 QBC 協調，見 6.1 #9）。
6. **金流**：ECPay 測試環境下單付款一輪（本機 DB）。
7. **後台**：會員列表顯示 87 位 profiles + 統計、訂單頁顯示 buyerEmail、Tier 規則編輯。

### 8.3 驗收標準

- 全部自動化項目綠燈；`pnpm build` 無錯。
- smoke test 3（跨裝置重置 + hope 同步生效）與 5（QBC 回歸）必須通過才能上線。
- 全專案 grep 不到 `next-auth`、`bcryptjs`、`prisma.user`。

---

## 9. 風險清單與回滾方式

| # | 風險 | 等級 | 緩解 | 回滾 |
|---|---|---|---|---|
| R1 | 專案層級設定（SMTP/模板/Redirect URLs）弄壞 hope 站信件流程 | **高** | 兩站通用模板（RedirectTo 設計）；低峰時段操作；改前截圖原設定；QBC 回歸測試 | Dashboard 貼回原模板/設定即可（分鐘級）；Redirect URLs 只增不刪不動 Site URL |
| R2 | Prisma 誤管 public schema 造成正式庫 drift/reset | **毀滅性** | 鐵則：不開 multiSchema、CI 檢查 schema.prisma 無 `@@schema("public")`、部署前人工審 migration SQL | 不允許發生（事前防範為唯一手段）；正式庫只有 course schema 可整個 drop 重建，public/auth 不受 Prisma 觸及 |
| R3 | secret key 洩入 client bundle | **高** | `lib/supabase/admin.ts` 加 `import 'server-only'`；變數名不帶 NEXT_PUBLIC_；build 後 grep client chunks | Dashboard 立即 rotate secret key |
| R4 | role 對映錯誤（coach/master 誤入後台或 admin 被擋） | 中 | 對映集中在 `lib/auth/role.ts` 單點；smoke test 用 admin + student 各驗一次 | 改一個檔案重部署 |
| R5 | webhook 改寫破壞交易性 → 付款成功未發貨/未累計 | **高** | MemberStats.upsert 與 enrollment.upsert 留在同一 `$transaction`；冪等測試打兩次 notify | Payment.rawCallback 留有存證，可寫一次性補單腳本重放 |
| R6 | PKCE 跨裝置開信失敗 / 連結被 prefetch 吃掉 | 中 | token_hash + verifyOtp 主流程；reset 頁容錯 code 與 hash 格式；真實信箱實測 | 改 `{{ .Token }}` OTP 或加中介確認頁（模板層面改，不動程式架構） |
| R7 | 密碼/註冊規則與 hope 不一致造成學員混亂 | 中 | 規則對齊 6 字元、metadata 對齊（display_name/nickname/role:student）；不動專案層級密碼設定 | 前端文案/驗證調整即可 |
| R8 | Vercel migrate deploy 走到 pooler 連線失敗 | 低 | directUrl 指 5432；首次部署前先 preview 環境驗 | 修 env 重部署 |
| R9 | 既有本機資料遺失 | 低 | 全是 seed 可重建的測試資料，明確接受清空 | `migrate reset` + seed |
| R10 | rate limit 實際值與盤點數字不符 | 低 | 實作前在 Dashboard Rate Limits 頁核對；前端以讀 Retry-After 為準而非寫死秒數 | — |

### 整體回滾策略

- **程式**：每階段獨立 commit/PR；course 站尚未上線前，任何階段都可 `git revert` 回 Auth.js 版本 + 本機 DB `migrate reset` 回舊 schema（舊 init 在 git 歷史中）。
- **正式 Supabase**：本計畫對正式庫的足跡只有（a）course schema（可整個 `DROP SCHEMA course CASCADE` 乾淨退場，不影響 QBC）與（b）Dashboard 設定（SMTP/模板/Redirect URLs，皆可在 Dashboard 還原）。auth/public 完全沒有寫入足跡，**不存在不可逆操作**。

---

## 10. 實作順序（每階段可獨立驗證）

> 階段 0–5 全在本機完成，不碰正式 Supabase 寫入；階段 6 起才涉及 Dashboard 設定與部署。

| 階段 | 內容 | 驗證方式（過了才進下一階段） |
|---|---|---|
| **0. 前置確認** | 使用者在 Dashboard 確認/建立 `sb_publishable_`/`sb_secret_` 新制金鑰；核對 Rate Limits 現值；確認本機 PG 可用 | 金鑰到手填入 .env；不做任何呼叫 |
| **1. 資料層** | 新 schema.prisma（第 3 節）；`?schema=course`；刪舊 migration 重生 init；改 seed.ts | 本機 `migrate reset` + seed 全綠；表都在 course schema |
| **2. Supabase client 基建** | 新增 lib/supabase/{client,server,proxy,admin}.ts、lib/auth/role.ts；裝 @supabase/ssr、@supabase/supabase-js、server-only | `pnpm tsc --noEmit` 過；尚未接線，原 Auth.js 仍在跑 |
| **3. Auth 核心切換** | 重寫 actions/auth.ts、proxy.ts、login/register 頁、logout-button、navbar；刪 auth.ts/auth.config.ts/next-auth.d.ts/[...nextauth]；移除 next-auth/bcryptjs 相依 | build 過；本機用真帳號登入/登出 smoke；未登入訪問保護路由被導走 |
| **4. userId/MemberStats 接線** | 6 個會員頁 + checkout + webhook + tier.ts + requireAdmin + admin layout 全面換 getAuthUser/MemberStats；Order 存 buyerEmail | `scripts/test-purchase-flow.ts` 全綠（含冪等重放）；登入後實際下單看課一輪 |
| **5. 後台改造** | admin 首頁 count、members 列表（admin client 讀 profiles）、orders 頁 buyerEmail；scripts/reset-testuser 改寫 | admin 帳號本機操作後台三頁全部正常；student 被擋 |
| **6. 忘記密碼功能** | forgot-password / reset-password 頁、/auth/confirm route、60 秒鎖鈕與 429 處理 | 自動化：confirm 錯誤分支 + 表單驗證；寄信成功與否取決於階段 7 |
| **7. SMTP 與品牌信（Dashboard，與使用者協作）** | 第 6.1 節 1–9 步：自訂 SMTP、Sender name 希望學院、品牌模板（RedirectTo 設計）、Redirect URLs、LOGO 素材 | 真實信箱收到品牌信；跨裝置完成重置；**hope 站回歸測試通過** |
| **8. 部署上線** | Vercel env（第 7.2）；首次部署在正式庫建 course schema（migrate deploy via 5432）；綁 course.huangxi.info | preview 環境先全流程 smoke → production；上線後完整跑 8.2 清單 |
| **9. 收尾** | 刪除殘留（grep next-auth/bcryptjs/prisma.user）；更新 HANDOFF.md、README env 說明 | grep 乾淨；文件最新 |

### 需要使用者提供/操作的事項彙總

1. 寄信服務帳號 + 寄件網域 DNS（SPF/DKIM）設定（階段 7）。
2. Supabase Dashboard 操作：新制 API 金鑰、SMTP 設定、Email 模板、Redirect URLs、Rate Limits 核對（階段 0、7）。
3. 「希望學院」正式 LOGO 原始檔（拿不到則採金色 HOPE 文字字標後備方案）。
4. 與 QBC 站開發者協調 Recovery 模板改 RedirectTo 後的 hope 端相容性與回歸測試（階段 7，上線前必須完成）。
5. 提供本人（或既有 tester）帳號做人工 smoke test；確認 admin 帳號可配合驗後台。
