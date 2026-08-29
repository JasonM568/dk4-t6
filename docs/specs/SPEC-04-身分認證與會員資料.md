# SPEC-04｜身分認證與會員資料

## 0. 文件資訊

| 欄位 | 內容 |
|---|---|
| 版本／日期 | v0.2 Draft／2026-08-29 |
| 路由 | `/login`、`/register`、`/forgot-password`、`/reset-password`、`/complete-profile`、`/dashboard/profile` |
| 真實來源 | 現行 Supabase Auth 程式、`MemberProfile`、Architecture |
| 狀態 | 現況基線 SPEC，待產品驗收 |

## 1. 概述

本模組管理帳號生命週期、session 與平台專屬會員資料。Supabase Auth 是帳密、Email 確認與 session 的唯一來源；`course.MemberProfile` 只保存手機與個資同意。本模組不得自行建立第二套帳密系統。

目標是讓一般使用者可安全註冊、登入、補齊個資、重設密碼及更新手機，並在帳號出現時認領待開通課程與歷史學員記錄。

產品語意：註冊只代表「已有平台帳號」，不等於上過課或已有影片權限。註冊完成後的責任是嘗試認領既有人物與待開通資格，並把結果清楚回報給營運模組。

## 2. 範圍與明確不做

### 2.1 範圍

- Email／密碼註冊與登入、登出。
- Email 確認 callback。
- 忘記／重設密碼。
- 首次登入補齊手機及個資同意。
- 會員自行更新手機。
- 註冊或建帳後認領 `PendingEnrollment`、`StudentRecord`、企業專區邀請相關資格。
- Proxy 與 Server 端雙層 session 驗證。

### 2.2 不做

- 不在 course schema 保存登入密碼雜湊。
- 不由本模組決定後台角色、課程觀看或付款狀態。
- 不把 `public.profiles` 改成 course schema 的可寫副本。
- 不在本期新增社群登入 provider、MFA 或刪除帳號流程。

## 3. 技術環境與約束

- 使用 Supabase Auth；README 的 Auth.js 描述為過時資訊。
- `public.profiles` 是外部共用資料，原則上唯讀；禁止 migration 修改 `public`／`auth` schema。
- 手機經 `normalizeMobile()`，Email trim＋lowercase。
- 密碼與 token 不得進 Prisma、log、audit detail 或 URL query。
- Proxy 只負責路由與 cookie 更新；Server Action／Server Component 必須重新取得可信 user。
- Session timeout、SMTP 與確認信設定屬 Supabase 專案層級，修改前需確認是否影響共用站台。

## 4. 相依與執行順序

1. Supabase server/browser clients 與 proxy。
2. 登入、註冊、Email callback、重設密碼。
3. `MemberProfile` 補齊與個資同意。
4. 註冊後跨模組認領流程。
5. 會員個人資料頁與測試。

相依模組：Platform、Learning Access、Student Database、Zones。跨模組認領失敗需記錄，但不得讓已成功建立的 Auth 帳號失效。

## 5. 資料模型

- Supabase `auth.users`：user id、Email、密碼與 session，外部 owner。
- `public.profiles`：顯示姓名、Email、最高管理員角色，唯讀。
- `MemberProfile`：`userId`、phone、privacyConsentAt、privacyConsentVersion。
- `MemberPassword`：現有管理員建帳初始密碼功能的已接受風險；本模組不得新增副本或擴大讀取範圍。
- `PendingEnrollment`、`StudentRecord`、`CourseGroupMember`：只透過公開 service 認領，不直接改寫其業務規則。

## 6. 角色與權限

| 操作 | 未登入 | 會員 | Editor/Admin |
|---|---:|---:|---:|
| 註冊／登入／忘記密碼 | 是 | 可導回會員區 | 是 |
| 查看／修改自己的手機 | 否 | 是 | 僅本人流程 |
| 修改他人帳號或密碼 | 否 | 否 | 走會員營運 SPEC |
| 讀取 session user | 僅公開流程 | 本人 | 依後台 RBAC |

## 7. 任務清單

### T1. 登入與 session
- 驗證錯誤使用通用文案，避免洩漏帳號是否存在。
- 保留登入後安全的 `next` 導回；只允許站內相對路徑，禁止 open redirect。

### T2. 註冊與 Email 確認
- Server 驗證 Email、密碼、姓名、手機與個資同意。
- 註冊成功後依 Supabase 狀態顯示確認信提示或登入狀態。
- Callback 只接受 Supabase 核發 token，失敗不得建立 course 資料。

### T3. 補齊與更新資料
- 缺手機或同意紀錄者登入後導向 `/complete-profile`。
- 同意需保存版本與時間；不可由 client 自報可信時間。
- 手機更新不得改動其他會員資料。

### T4. 跨模組認領
- 成功取得 userId 後依序認領待開通與歷史學員記錄。
- 認領需冪等；共用 Email 無法唯一判定 StudentRecord 時不得猜測。
- 匹配優先序固定為：已驗證 userId → normalized phone 唯一命中 → normalized Email 且只有一筆、姓名相容；任一步出現多筆或姓名衝突即停止自動認領。
- 認領結果需回傳 `CLAIMED`、`NO_MATCH`、`AMBIGUOUS`、`FAILED`，供 SPEC-10 顯示待人工處理；不得只寫 console。
- `PendingEnrollment` 的 Email 唯一命中可依既有規則認領課程，但不得順便猜測並合併多張 StudentRecord。
- 認領成功後保留歷史學員卡與 claimedUserId，不把 StudentRecord 刪除或搬進 profile。

### T5. 安全與測試
- 測試未登入守門、錯誤 token、open redirect、重複註冊、認領冪等與個資補齊。

## 8. 驗收標準

| 編號 | 條件 |
|---|---|
| AC-01 | 新使用者可註冊、確認 Email、登入及登出 |
| AC-02 | 錯誤帳密不洩漏帳號是否存在 |
| AC-03 | 未登入者無法進入會員與後台受保護頁 |
| AC-04 | `next` 不能導向外部網域 |
| AC-05 | 缺手機或個資同意者被導向補齊頁，完成後保存可信版本與時間 |
| AC-06 | 忘記／重設密碼 token 無效或過期時不更新密碼 |
| AC-07 | 註冊／建帳後待開通認領冪等，不重複建立 Enrollment |
| AC-08 | 共用 Email 的多筆 StudentRecord 不會被錯誤認領 |
| AC-09 | course migration 不修改 `auth`／`public` schema |
| AC-10 | 密碼、token 不出現在資料庫業務表、log 或 URL |
| AC-11 | typecheck、auth/claim DB tests、lint、build 通過 |
| AC-12 | 註冊完成但沒有 Enrollment 的會員仍顯示為已註冊、不可觀看，不被誤標成已開通 |
| AC-13 | 手機唯一命中可正確認領；共用 Email、多筆或姓名衝突回傳 AMBIGUOUS 且不合併 |
| AC-14 | 認領 pending 後只建立對應課程 Enrollment，重跑不重複且不改動其他履歷 |

## 9. 非功能需求與 Agent 指示

- 安全優先於便利；所有寫入在 Server 端重驗。
- 不得根據 README 導入 NextAuth。
- 修改註冊流程時必跑 `test-register-autoclaim.ts`、`test-student-claim.ts` 及 server action check。
- 待確認：是否啟用 Google OAuth、帳號刪除與 MFA；未確認前不得實作。
