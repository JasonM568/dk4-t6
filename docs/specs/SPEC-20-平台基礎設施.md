# SPEC-20｜平台基礎設施

## 0. 文件資訊
版本 v0.1 Draft；日期 2026-08-29；涵蓋 Prisma/PostgreSQL、Supabase clients、Next proxy、安全標頭、環境變數、cron、觀測、migration 與部署。

## 1. 概述
本模組提供所有 domain 的共用執行環境與安全邊界，不吸收業務規則。目標是在本機、Preview、Production 可重現建置，秘密不外洩，migration 安全可回滾，webhook/cron 有驗證與冪等，錯誤可觀測。

## 2. 範圍與明確不做
- 範圍：DB client、Supabase clients/session proxy、env、headers/CSP、cron auth、server-only 邊界、logging、migration/deploy/test gates。
- 不做：不擁有課程、會員、訂單、行銷等資料與決策；不為模組化先引入 queue/microservice；不跨 schema 修改 QBC 資料。

## 3. 技術環境與約束
- Next.js 16/React 19/TypeScript；Prisma 6/PostgreSQL course schema；Supabase Auth/Storage；Vercel。
- Prisma migration 禁止 public/auth/drop schema；先本機 deploy、人工審 SQL，再部署。
- Server-only secret 不得 `NEXT_PUBLIC_`、進 client、log、URL 或 audit。
- Production/Preview/Development 憑證分離；本機 SMS 預設 dry-run。
- CSP 目前 Report-Only，切 enforced 需觀察與驗收，不得為消除報告直接放寬 `*`。
- `use server` 檔只 export async function。

## 4. 相依與執行順序
env/schema → clients → proxy/headers → provider secrets → cron/webhook → observability → CI/build/deploy → disaster/recovery。Platform 只能被 domain 依賴，不能反向 import domain。

## 5. 資料模型與設定
- Prisma `_prisma_migrations`；`CspReport` 去重累計；domain 的 SiteSetting key 由 domain owner 管。
- Env 分組：DB、Supabase、Site、Payment、Email、SMS、Board、Cron。
- 建立 env registry，標示 public/server、必填環境、owner、輪替方式，不保存實值。

## 6. 角色與權限
一般使用者無平台管理介面；部署與秘密由授權維運者管理；Full Admin 只能透過產品 UI 改明定 SiteSetting，不能讀 server secrets。Cron 與 webhook 以各自 secret/signature 驗證，不視為使用者角色。

## 7. 任務清單
- T1 DB：singleton client、連線、transaction、migration 命名與安全掃描。
- T2 Supabase：browser/server/admin clients 分離，admin client server-only、profiles 唯讀。
- T3 Proxy/headers：session 更新、受保護路由、HSTS/nosniff/referrer/permissions/frame/CSP。
- T4 非同步：CRON_SECRET、claim 狀態、逾時回收、domain 隔離；webhook raw body 驗簽與冪等。
- T5 Observability：結構化去敏 log、CSP upsert 避免 unique 噪音、provider 錯誤可追蹤。
- T6 CI/deploy：actions check、Prisma generate/deploy、typecheck、lint、tests、build，migration 先於新程式查欄位。
- T7 文件：README 與現況同步，尤其移除過時 Auth.js/Postgres/Vercel 說明衝突。

## 8. 驗收標準
| 編號 | 條件 |
|---|---|
| AC-01 | client bundle 不含 DB、Supabase secret、provider key 或 webhook secret |
| AC-02 | 未登入受保護路由被擋，Server 端仍重新授權 |
| AC-03 | migration 只作用 course schema，無破壞性 SQL 且 deploy 順序正確 |
| AC-04 | cron 無正確 Bearer secret 不執行工作 |
| AC-05 | webhook 驗簽、時間窗與 DB 冪等可抵抗重送／偽造 |
| AC-06 | 安全標頭存在，CSP 不以萬用來源掩蓋違規 |
| AC-07 | Production 不使用測試憑證／localhost fallback，本機不誤發付費 SMS |
| AC-08 | log/audit 不含密碼、token、key、完整手機名單或付款秘密 |
| AC-09 | CSP 相同事件以 upsert 累加，不持續產生 unique error 噪音 |
| AC-10 | clean install、migrate status、server actions、typecheck、lint、tests、production build 通過 |

## 9. 非功能需求與 Agent 指示
變更 provider、schema、權限或核心流程必須同次更新 Architecture／對應 SPEC。避免長任務超過 Vercel 限制；達瓶頸才評估 durable queue。待確認 CSP enforced 時程、備份/還原 RPO/RTO、Preview 資料隔離政策。
