# course-platform Bug 修復任務

> 來源：2026-07-06 自動化檢查 + 子任務深度掃描
> 狀態：待電腦端執行
> ⚠️ 此專案已上線（course.huangxi.info），Critical 項目需盡快處理
> 完整報告：`~/.hermes/cache/delegation/subagent-summary-*-20260708_025150_*.txt`

---

## 🔴 Critical（立即處理）

### C1. `.env` 含 Production Secrets 明文
- **檔案**：`.env` L20
- **風險**：`SUPABASE_SECRET_KEY` 明文存在本機 .env，可 bypass RLS 完全控制 Supabase
- **處理**：
  1. 確認 `.env` 是否在 `.gitignore`（應該是）
  2. 本機開發應用獨立 dev credentials，不要用 production key
  3. 如果這把 key 曾被 commit 過，立即到 Supabase rotate

---

## 🟡 Medium（部署前應修）

### M1. FAILED→PAID 狀態轉換未擋
- **檔案**：`src/app/api/payment/ecpay/notify/route.ts` L47-49
- **風險**：如果訂單已 FAILED，後續成功通知仍會改為 PAID
- **修復**：L47 改為 `if (order.status !== "PENDING") return;`

### M2. MemberPassword 明文密碼存儲
- **風險**：管理員設定的密碼以明文存儲
- **修復**：加密存儲（AES-256），或改為一次性顯示、不永久存儲

---

## 🟢 Low（可後續處理）

### L1. ECPay merchantId 取法不一致
- **檔案**：notify/route.ts L31-36 vs src/lib/payment/index.ts L29-41
- **風險**：兩處 production 判斷邏輯微妙不一致
- **修復**：統一用 `getEcpayConfig().merchantId`

### L2. 3 個 ESLint warnings
- **檔案**：
  - `src/app/(admin)/admin/courses/[id]/members/members-manager.tsx` L46
  - `src/app/(admin)/admin/members/member-table.tsx` L53, L61
- **問題**：三元表達式當 statement 用
- **修復**：改為 if/else

---

## ✅ 確認安全（無需處理）

- RBAC 三級權限架構正確（所有端點都有認證/授權）
- SQL Injection — 0 風險
- XSS — 0 風險
- CSRF — Next.js 內建保護
- Supabase Secret Key 只在 server-only 模組
- ECPay 簽章 + 金額驗證 + 冪等 — 四道防線完整
- 課程觀看權限 — enrollment 為唯一來源，無繞過
- 會員等級計算 — 折扣數學正確
- Prisma migration — 只操作 course schema，不碰 public
- 金流 transaction — 原子性正確
