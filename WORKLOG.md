# WORKLOG — 工作日誌

> 每日收工摘要（做了什麼／為什麼／未完成）。逐項細節與架構脈絡見 `HANDOFF.md`。

## 2026-08-08

**三案全部完成並部署上線：**

1. **資安修復 6 項**（SECURITY_FIX_TODO 清單，P0-1 依 Jason 決定跳過保留明文密碼備查）
   - 密碼重設越權（僅 admin＋逐筆驗身分＋AdminAuditLog 稽核）、Next/React 升安全版、
     xlsx→exceljs（+CSV 獨立 parser/magic bytes/解析上限）、看板 4 位碼強化
     （獨立 secret/HMAC/DB 共享限流）、結帳競態（checkoutKey 原子防重+crypto orderNo）、
     安全標頭（7 項；完整 CSP 白名單 Report-Only 觀察中）
   - 決策：P0-1 跳過是因 MemberPassword 為使用者明確要求的取捨；改以「重設僅限 admin」補防線
2. **簡訊模組接 MAAC Go**（sms.cresclab.com，第一個真簡訊商）
   - 正式站已切真發送（NT$0.78/段，帳戶餘額 NT$50 試用）；本機刻意維持 dryrun 防誤發
   - 決策：逐通打 /sms/send 不用 /broadcast——內容逐人渲染，要保住「逐筆對應回傳」約定
   - MCP 另裝在使用者層級（~/.claude.json），API key 三處存放皆在 repo 外（repo 是 public）
3. **會員手機必填＋個資法同意**
   - 新表 MemberProfile（course schema）；註冊必填＋既有會員登入強制補填＋會員資料頁
   - 條款 2026-08-08.v1 Jason 已核可；⚠️ 蒐集機關「希望學院學習平台」，禁用黃璽品牌（曾誤植被糾正）

4. **1shop 訂單回填會員手機**（第二次收工後加做，已部署）
   - 後台 /admin/members/phone-import：上傳訂單檔 → 顧客信箱對會員 → 回填顧客電話＋查核報告
   - 決策：回填只寫 phone「不代填同意」（同意欄位改 nullable）——個資同意必須由會員本人勾選，
     回填會員登入時手機預填、勾同意即完成；會員自填手機絕不覆蓋，衝突列報告

**未完成／待辦：**
- Jason 將實際上傳 1shop 訂單檔跑回填（報告有異常截圖回報）；本機 dev DB 尚未套
  20260815100000 migration（下次本機開發前 `npx prisma migrate deploy`）
- 簡訊實測：/admin/sms 發一則給自己驗證（綠色已發送＋MAAC Go 扣款）
- 看板驗收：重輸 4 位碼、連錯 5 次限流測試
- CSP Report-Only 觀察 1–2 週後切正式阻擋
- MAAC Go 送達 webhook（回流逐筆狀態）、會員手機串簡訊名單——待指示
- `.mcp.json` 有一筆別條線留的未 commit 修改（移除 Supabase MCP 設定），待 Jason 決定去留
