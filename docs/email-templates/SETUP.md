# 希望學院品牌信 — Supabase Dashboard 設定步驟（使用者操作）

> 對應 REFACTOR_PLAN.md 第 6.1 節步驟 #3／#4／#5／#8。
> 這些都是 **Supabase 專案層級**設定（專案 qubjpayeopvscrgrvrci），會同時影響 hope.huangxi.info（QBC）——
> 操作前請先截圖原設定，並挑低峰時段進行；改完模板務必通知 QBC 開發者做回歸測試（計畫書 6.1 #9）。

## 前置（對應 #1／#2，需先完成）

- 已申請寄信服務（建議 Resend）並完成寄件網域（如 `mail.huangxi.info`）的 SPF/DKIM 驗證，拿到 SMTP host／port／user／pass。
- **已關閉寄信服務的 link/click tracking**（tracking 會改寫信中連結導致 token 失效）。

## 步驟 3：設定自訂 SMTP

1. Supabase Dashboard → 專案 → **Authentication → Emails → SMTP Settings**。
2. 開啟 Enable Custom SMTP，填入：
   - Host／Port／Username／Password：寄信服務提供的值
   - Sender email：如 `no-reply@mail.huangxi.info`
   - **Sender name：`希望學院`**
3. 儲存。此後兩站（course／hope）的所有 Auth 信件都會以「希望學院」抬頭寄出。

> 背景：未設自訂 SMTP 時，Supabase 內建 SMTP 只寄給專案 Team 成員（其他人收到 Email address not authorized），且每小時僅約 2 封——這是目前重置信寄不出去的根因。

## 步驟 4：核對 Rate Limits

1. Dashboard → **Authentication → Rate Limits**。
2. 核對「Email 寄送上限」：自訂 SMTP 啟用後預設僅 **30 封/小時**，依需求調高。
3. 同時記下同一使用者的寄信冷卻期（預設 60 秒）——前端重寄鎖鈕以此為準；若 Dashboard 顯示不同值，回報調整前端倒數秒數。

## 步驟 5：Redirect URLs 加入白名單

1. Dashboard → **Authentication → URL Configuration**。
2. **Site URL 絕對不要動**（hope 站在用）。
3. 在 **Redirect URLs** 新增以下四筆（只增不刪）：
   - `https://course.huangxi.info/auth/confirm`
   - `https://course.huangxi.info/reset-password`
   - `http://localhost:3000/auth/confirm`
   - `http://localhost:3000/reset-password`

> 不加白名單時，程式傳入的 redirectTo 會被退回 hope 的 Site URL，造成跨站混淆。

## 步驟 8：替換 Reset Password 信件模板

1. Dashboard → **Authentication → Email Templates → Reset Password**。
2. **先把現有模板原文複製備份**（回滾用）。
3. Subject 填：`重設你的希望學院帳號密碼`。
4. Body 貼上本資料夾的 [`recovery.html`](./recovery.html) 全文（含開頭 HTML 註解可一併貼上或刪除皆可）。
5. 若 Dashboard 有純文字（plain text）欄位，貼上 [`recovery.txt`](./recovery.txt)。
6. 儲存。

模板關鍵設計（請勿改動連結寫法）：

- 連結必須是 `{{ .RedirectTo }}?token_hash={{ .TokenHash }}&type=recovery`
  - `{{ .RedirectTo }}` 由各站呼叫 `resetPasswordForEmail` 時傳入（course 站傳 `/auth/confirm`），所以**一份模板兩站通用**。
  - token_hash 模式不依賴 PKCE，跨裝置／瀏覽器開信也能用。
- LOGO 用絕對網址 `https://course.huangxi.info/brand/hope-academy-logo-email.jpg`（360px，34KB）——**course 站部署上線後此圖才存在**；上線前測試時信件圖片會破圖，屬預期現象。
- 文案站台中性（「重設你的希望學院帳號密碼」），不寫死任一站網址。

## 完成後驗收

1. course 站 `/forgot-password` 發起重置 → 收到「希望學院」抬頭品牌信。
2. 用**另一台裝置**（如手機）開信點連結 → 能進 `/reset-password` 改密碼。
3. 改完密碼後，用新密碼在 **hope.huangxi.info 登入成功**（兩站同帳密驗證）。
4. hope 站自己的忘記密碼流程仍走得通（QBC 回歸，計畫書 6.1 #9）。
5. 若 Gmail/Outlook 的連結被收件端 prefetch 吃掉（點開顯示已失效），回報後改用 `{{ .Token }}` 6 位數 OTP 或中介確認頁方案。

## 回滾

- 模板／SMTP／Sender name：Dashboard 貼回備份的原設定即可（分鐘級）。
- Redirect URLs：只增不刪，無需回滾。
