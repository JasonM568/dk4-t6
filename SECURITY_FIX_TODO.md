# Course Platform 資安修復待辦清單

> **狀態（2026-08-08）：已完成並部署。**
> P0-2 / P0-3 / P1-4 / P1-5 / P1-6 / P2-7 全數修復（見 HANDOFF.md 2026-08-08 段落與 security-fixes 各 commit）。
> **P0-1（明文密碼備查移除）依 Jason 決定跳過**——MemberPassword 為使用者明確要求的取捨，維持現狀；
> 已加防線：密碼重設僅限 admin。CSP 完整白名單目前 Report-Only 觀察中。

建立日期：2026-08-08  
專案：`/Users/jasonmchen/course-platform`  
執行者：Claude  
範圍：修復已確認的資安問題；看板登入碼維持 **4 位數字**。

## 執行原則

- 先建立修復分支，逐項提交，避免一次混入大量變更。
- 不可對正式 Supabase 執行測試註冊、破壞性 migration 或測試資料寫入。
- Prisma 只能管理 `course` schema，不可加入 `public`／`auth` model 或啟用 multiSchema。
- Migration 必須手寫並檢查不得包含 `DROP SCHEMA`、`public.`、`auth.`。
- 不得在 log、錯誤訊息、測試快照或 Git 中留下密碼、token、secret、完整金流 callback。
- 每項修復完成後，執行型別檢查、lint、build 與該項專用測試。

## P0：立即修復

### 1. 移除會員明文密碼的保存與顯示

相關位置：

- `prisma/schema.prisma`：`MemberPassword`
- `src/actions/admin.ts`：`recordMemberPassword` 及所有呼叫點
- `src/app/(admin)/admin/members/page.tsx`
- `src/app/(admin)/admin/members/member-table.tsx`
- 會員新增、匯入、批次建立、批次開通與重設密碼流程

工作內容：

- 移除所有把原始密碼寫入 `MemberPassword` 的程式。
- 移除後台讀取、傳遞、顯示或複製初始密碼的功能與型別欄位。
- 建立安全 migration，清除既有明文資料並移除 `MemberPassword` 表；若因分階段部署不能立即 drop，第一階段至少清空資料、停止讀寫，再於下一版 drop。
- 會員密碼交付改成 Supabase 密碼重設／邀請連結。連結需一次性、限時且由 Supabase 管理，不自行保存 token。
- 新增／匯入會員若仍需暫時設定密碼，不得持久化或回顯；優先改為寄送設定密碼連結。
- 檢查歷史 log、匯出與錯誤處理，確保不再輸出密碼。

驗收條件：

- 全專案搜尋不到 `MemberPassword`、`memberPassword`、`recordMemberPassword`。
- 資料庫不再保存任何可還原的會員密碼。
- 後台頁面與 Server Action 回應不包含密碼。
- 新增、匯入、重設會員仍有可用且安全的帳號啟用流程。

### 2. 修正批次重設密碼可越權操作管理員

相關位置：`src/actions/admin.ts` 的 `bulkSetPasswordAction`、`resetMemberPasswordAction`。

工作內容：

- 密碼重設能力改為只允許 `requireFullAdmin()`；若產品決策仍允許 operator，則必須另建非常明確的 capability，但預設不得允許。
- 批次與單筆路徑都要在 server 端逐筆取得 profile 並拒絕：`role=admin`、目前登入者、找不到的 userId。
- 不可信任前端傳入的 `userIds` 或頁面篩選結果。
- 對批次操作加入稽核紀錄，只記操作者、目標 userId、時間、成功／失敗，不記密碼。
- 失敗時回傳清楚統計，不可靜默跳過造成管理員誤判。

驗收條件：

- operator 直接呼叫 Server Action 會被拒絕。
- 即使竄改 FormData 傳入 admin UUID，也無法重設管理員密碼。
- 一般會員的合法管理員重設流程仍可運作。
- 有自動化測試覆蓋 admin、operator、coach、未登入四種角色。

### 3. 升級 Next.js 與 React 安全版本

目前版本：Next.js `16.2.7`、React／React DOM `19.2.4`。

工作內容：

- Next.js 至少升級到 `16.2.11`，但應先查當下 16.2.x 或相容版本的最新安全修補版。
- React、React DOM 及 lockfile 中的 `react-server-dom-*` 至少升級到 `19.2.6`，三者版本保持相容。
- 同步更新 `eslint-config-next`。
- 重新產生 `pnpm-lock.yaml`，執行完整依賴稽核。
- 確認 Vercel build、Server Actions、Supabase session proxy、登入、後台與付款流程沒有回歸。
- 若有自架或 preview proxy，固定／驗證 `Host` 與 `X-Forwarded-Host`；正式 origin 可設定 `__NEXT_PRIVATE_ORIGIN` 作額外防線。

驗收條件：

- `pnpm list next react react-dom` 顯示安全版本。
- `pnpm audit` 不再回報本次 Next.js SSRF 與 React RSC DoS 公告。
- `pnpm exec tsc --noEmit`、`pnpm lint`、`pnpm build` 全部通過。
- 登入、登出、Server Actions、受保護路由及付款 callback smoke test 通過。

## P1：高優先修復

### 4. 替換或隔離有漏洞的 `xlsx@0.18.5`

相關位置：

- `package.json`、`pnpm-lock.yaml`
- `src/lib/session-import.ts`
- `src/actions/sessions.ts` 的 `uploadOrdersAction`

工作內容：

- 優先改用持續維護、無相關 prototype pollution／ReDoS 公告的 XLSX 解析方案；確認授權與 serverless 相容性。
- 若選擇 SheetJS 官方修補來源，必須固定精確版本與可信來源，不可繼續使用 npm 上的 `xlsx@0.18.5`。
- CSV 優先走獨立、安全的 CSV parser，不要把 CSV 交給 XLSX parser。
- 驗證實際副檔名、MIME、magic bytes；不只相信瀏覽器提供的 `file.type`。
- 保留檔案大小限制，另加入工作表數、列數、欄數、字串長度與解析時間上限。
- 解析失敗只回通用錯誤，詳細內容留在不含個資的 server log。

驗收條件：

- 依賴樹不再包含 `xlsx@0.18.5`。
- 正常 1shop XLSX／CSV 樣本匯入結果與原本一致。
- 畸形、大量列欄、偽造副檔名與惡意 XLSX 測試會快速、安全失敗。

### 5. 強化看板 4 位數字登入（必須維持 4 位數字）

產品限制：登入碼仍為 `0000`–`9999` 的 **4 位數字**，不可改成 8 位或英數混合。

相關位置：

- `src/actions/board.ts`
- `src/lib/board-auth.ts`
- 看板設定 Server Action 與 UI

工作內容：

- 新增獨立必填的高熵環境變數 `BOARD_SESSION_SECRET`，不得沿用 `UNSUBSCRIBE_SECRET`，也不得有固定 fallback。
- 啟動或首次使用時若 secret 缺漏，安全失敗並明確記錄設定錯誤，不可退回公開字串。
- Cookie 簽章改用 `HMAC-SHA256(secret, version + code + expiry + nonce)`，驗證使用 `timingSafeEqual`。
- 登入碼 server 端嚴格驗證 `^\d{4}$`；設定看板碼時也使用同一規則。
- 加入共享式限流，不可只用單一 process 記憶體：至少依 IP＋全域看板維度限制失敗次數。
- 建議策略：同 IP 連續失敗 5 次鎖 15 分鐘；全域異常門檻觸發更長冷卻與告警。成功後重置該 IP 計數。
- 不可信任任意 `X-Forwarded-For`；只採用 Vercel／可信代理規範下的來源 IP。
- 保留固定時間回應或加入抖動，避免正確／錯誤碼時序差異。
- Cookie 保持 `httpOnly`、正式環境 `secure`、`sameSite=lax`；加入版本欄位，改 secret 或改碼時讓舊 cookie 失效。
- 將預設 session 時效降至合理範圍，建議 8–24 小時；最高值不建議維持 720 小時。
- 不在 log 中記錄使用者輸入的 4 位碼或完整 cookie。

驗收條件：

- UI 與 API 仍只接受 4 位數字。
- 未設定 `BOARD_SESSION_SECRET` 時不能產生可用 session。
- 偽造、過期、改碼前、舊版本與錯誤簽章 cookie 都會被拒絕。
- 第 6 次連續錯誤嘗試會被限流，重啟單一 instance 也不會清除封鎖狀態。
- 有測試覆蓋 `0000`、前導零、錯誤格式、過期、竄改、限流與 secret rotation。

### 6. 修正結帳防重的競態條件

相關位置：

- `src/actions/checkout.ts`
- `prisma/schema.prisma`
- 訂單過期／失敗狀態處理

工作內容：

- 不可依賴「先 `findFirst`、再 `create`」防重。
- 設計資料庫層原子保證，使同一 `userId + courseId` 同時只能有一筆有效 `PENDING` 訂單。
- PostgreSQL 可使用 partial unique index；因 `courseId` 位於 OrderItem，需評估增加明確 checkout key、pending purchase lock 表，或在 transaction 中使用 advisory lock。選擇必須可被 Prisma migration 安全管理。
- 訂單過期後要有明確狀態轉換，否則舊 PENDING 會永久阻擋購買。
- `orderNo` 改用加密安全亂數或 UUID 衍生值，保證符合 ECPay 20 字元限制；不要只使用時間戳加 `Math.random()`。
- 金流表單建立失敗時，要讓訂單可安全重試或轉為失敗，不留下永久 PENDING。

驗收條件：

- 對同一使用者與課程同時送出至少 20 個 checkout 請求，資料庫最多只有一筆有效 PENDING 訂單。
- 不同課程或不同使用者不會互相阻擋。
- 過期／失敗訂單後可以重新下單。
- ECPay webhook 的既有冪等、金額與 MerchantID 驗證仍通過。

## P2：防禦加強

### 7. 新增 HTTP 安全標頭與 CSP

相關位置：`next.config.ts`、必要時 `src/proxy.ts` 或 Vercel 設定。

工作內容：

- 加入至少：
  - `X-Content-Type-Options: nosniff`
  - `Referrer-Policy: strict-origin-when-cross-origin`
  - `Permissions-Policy`，只開實際需要的功能
  - `Content-Security-Policy`，至少包含 `frame-ancestors 'none'` 或等價防 clickjacking 設定
  - `Strict-Transport-Security`，只在確定全站 HTTPS 與子網域策略後啟用
- CSP 應從實際使用來源建立白名單：Supabase Storage、YouTube／嵌入內容、ECPay、追蹤工具與必要圖片來源。
- 不要為了相容直接長期使用寬鬆的 `script-src *` 或 `unsafe-eval`。
- 後台可設定追蹤碼的功能需特別檢查；若目前允許任意 script，應限制格式、來源與僅限 full admin。
- 先在 preview 使用 `Content-Security-Policy-Report-Only` 蒐集違規，再切換為正式阻擋。

驗收條件：

- 正式回應可看到上述標頭。
- 外部網站不能 iframe 嵌入敏感頁面。
- 登入、Supabase、YouTube／允許的 embed、圖片、ECPay 跳轉與追蹤功能正常。
- CSP 不允許未列入白名單的 script 執行。

## 完整驗證與交付

完成所有項目後：

1. 執行：
   - `pnpm exec tsc --noEmit`
   - `pnpm lint`
   - `pnpm build`
   - `pnpm audit`
2. 新增或更新資安回歸測試：RBAC、批次密碼、看板 cookie／限流、checkout concurrency、惡意 XLSX、security headers。
3. 檢查 Git diff 與歷史新增檔案，不得包含 `.env`、密碼、token、secret 或正式個資。
4. 提供 migration SQL 審查摘要，明列所有 drop／delete 操作及回復方案。
5. 提供逐項修復摘要、測試證據、尚未解決的風險與正式部署步驟。
6. 正式部署前備份 `course` schema；不得碰觸共用 Supabase 的 `public` 與 `auth` schema。

## 建議執行順序

1. P0-1 明文密碼移除
2. P0-2 密碼重設越權
3. P0-3 Next.js／React 升級
4. P1-4 XLSX 替換
5. P1-5 看板驗證強化（維持 4 位數字）
6. P1-6 結帳競態
7. P2-7 安全標頭與 CSP
8. 全套回歸測試與 preview 驗證
