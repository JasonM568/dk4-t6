# WORKLOG — 工作日誌

> 每日收工摘要（做了什麼／為什麼／未完成）。逐項細節與架構脈絡見 `HANDOFF.md`。

## 2026-08-30

**三案全部合入 main 並部署上線（PR #6/#7/#8，正式站與正式庫已查證）：**

1. **P1–P3 安全/邏輯 bug 第二輪 8 項**（PR #6，詳見 docs/worklogs/2026-08-29-安全邏輯bug第二輪.md）：
   open redirect 反斜線繞過 ×4（新增 lib/safe-redirect.ts 統一防線）、ECPay notify 冪等
   分岔改委派 settle.ts、checkoutKey 離開 PENDING 一律釋放、課程排序競態收進
   Serializable 交易、computeDiscount clamp、重複付款防護（DUPLICATE_PAID 拒絕結算＋
   標記待退款）、reset-password 移除 hash token 注入、免費課 price=0 擋上架
2. **場次報名頁接平台金流**（PR #7）：報名方式 3 模式（EXTERNAL 導 1shop／PLATFORM
   平台金流／MANUAL 手動收款），PLATFORM = 訪客免登入填表 → SessionSignupOrder →
   PAYUNi 刷卡+ATM → 付款成功自動轉入場次名單＋開 ezPay 發票＋加名單群組。
   **Jason 已實刷驗證刷卡＋自動開發票**。感謝頁 /event/thanks；ATM 三態 pending
3. **自動辨識新生/舊生定價**（PR #8）：報名時用手機（優先）/email（唯一一筆才採信）
   查學員上課史，上過任一「複訓資格課程」（signupRetrainCourseIds，經課名歸戶）＝
   複訓價，否則新生價；同行者逐位判定可混價、伺服器端重算防竄改；前台即時試算。
   量子思維設定：資格課程勾量子族、複訓 2380／新生早鳥 5880

- 測試：test-safe-redirect 19、test-session-payment-db 13、test-session-tier-db 9 全過；
  migration 三支全 additive，正式庫已查證（SessionSignupOrder 表＋4 欄位在）
- **0919 切換方式**：後台場次 → 報名頁設定 → 報名方式選「平台線上金流」、新生價 5880、
  複訓價 2380、資格課程勾量子系列 → 儲存即生效（目前仍是導 1shop，未切）
- ⚠️ 已知缺口：ATM 取號的虛擬帳號感謝頁未顯示（只說等待繳款）；ATM 佔比高要補
- 冷名單 EDM 行銷計畫（沉睡 994 人 → 影片嵌報名頁 → EDM＋簡訊導流）規劃完成，
  待 0919 報名頁切平台金流後執行

## 2026-08-13

**場次模組迭代收尾（8/12 上線後依 Jason 實際使用回饋修，全數已部署）：**

1. **葷素判讀修正**（真實檔案 order_2026_08_12 驗證）：1shop 每個銷售頁的自訂欄位
   在匯出檔**各自成一欄**（「課程用餐葷素」×6）——改讀全部命中欄逐列取非空值，
   加訂單資訊文字備援（取冒號後的值，防「葷素」的素字誤判）；葷素 UI 改下拉直選
2. **同行者解析重寫**：「姓名緊鄰電話」成對抽取（兩組人各配各的電話）、信箱一併抽、
   生日/地址混雜欄可解（黃淑華→李舜泰實例）；同行者電話/信箱入庫；
   「數量 ≥2 但辨識不足」列入匯入報告人工確認清單；「總計」列不計噪音
3. **同單第二人**：手動新增自動用 manual-N 識別鍵（黃淑華訂單補李舜泰被唯一鍵擋的修正）；
   匯入同單同名跨鍵去重，手動補過的人重匯不變兩筆
4. **補分組**：每日更新名單後只分新報名進現有組（不動已分好的，全滿才開新組）
5. **逐組上限**（groupCaps）：各組 chip 上直接改該組上限，分組演算法容量感知
6. **工作人員名單**（isStaff）：不列入分組與新舊生統計、計入用餐葷素；
   看板/簽到表獨立顯示
7. **姓名就地編輯**：英文名手動標註中文，離開欄位即存，重匯不覆蓋

測試累計：roster 31 項＋匯入解析 30 項全過。模組調整告一段落。

**待辦不變**：EDM 影片行銷第一版、LessonProgress 觀看時長、P1-P3 剩餘 bug、
CSP 觀察期約 8/19 查 CspReport 後切正式阻擋、簡訊/看板驗收（Jason 本人）。

## 2026-08-12

**場次學員統計／葷素／延期／自動分組模組（已部署上線＋正式站查證）**

- 需求：開課前統計原在 Excel 手動維護（1shop＋口頭告知＋前場延期），口頭名單偶爾漏；
  全部收進場次模組，Excel 只剩匯出簽到表。規格 Jason 拍板：葷素從訂單檔「餐點/用餐」欄
  自動帶、每組上限預設 8（組數 = max(6, ⌈人數/上限⌉)）、每組新舊 6:4、延期原場標記新場建新筆。
- 關鍵設計：延期列**沿用原 orderNo**——1shop 退款全域刪除自然連延期列一併清（DB 實測確認）；
  葷素回填只補未標列不覆蓋手動標記；看板維持不外洩電話/信箱。
- 驗證：純函式 21 項＋匯入解析 19 項＋本機 DB 整合 9 項全過；正式庫欄位/migration 已查證，
  簽到表未登入 403 正常。
- ⚠️ 已知取捨：「不吃素」會被判成素（值含素字），後台逐人切換是逃生口。
- 待 Jason 實際走一輪：上傳真訂單檔看葷素判讀、自動分組、匯出簽到表開 Excel 檢查版面。

**舊生複訓身分核對：email → 手機（已部署上線）**

- 起因：蘇郁雅報名填的是先生陳建中的信箱（`tsung0906@gmail.com`）。email 是唯一鍵時
  第二個人根本建不了檔；用 email 認領歷史紀錄則會把另一半的上課紀錄掛到自己帳號上。
- 查到的事實：正式站 `StudentRecord` / `StudentCourseHistory` **都是 0 筆**——原本的
  「查無此 Email 就擋」等於一律擋，任何人都加不了複訓。既有 25 筆複訓全是訂單檔匯入，沒經過這道閘。
- 決策（Jason 拍板）：查無手機時**不硬擋**，勾「確認為舊生」即一併建檔，資料庫逐步累積。
- 改動：phone 改唯一鍵、email 改選填不唯一；匯入以手機為 upsert 鍵（只有 email 的舊名單仍
  可匯入，回報缺手機筆數）；認領手機優先、email 僅在只對到一筆時當備援、已認領的不搶；
  會員中心歷史紀錄改認 `claimedUserId`。`scripts/test-student-claim.ts` 7 情境全過。

**CSP 違規收集端點（已部署）**

- 查到的問題：Report-Only 完整白名單掛著，但**沒有 report-uri**——違規只印在使用者的
  瀏覽器 console，8/08 起的「觀察 1–2 週」其實一筆都沒收到，等於空轉四天。
- 補上 `/api/csp-report` + `CspReport` 表。公開端點（瀏覽器送報告不帶 cookie，無法驗身分），
  防線放在寫入內容：限 content-type/body 大小、欄位截斷、只留 pathname（網址可能帶 token）、
  丟棄瀏覽器擴充套件噪音、同組合累加、不同組合上限 500 列。
- **下一步（約 8/19 後）**：查 `course."CspReport"` 依 count 排序，確認沒有自家來源被擋，
  就把 `REPORT_ONLY_CSP` 內容搬進 `ENFORCED_CSP` 切正式阻擋。表空的就代表無誤殺。

**收尾：** 本機補套 `20260811090000_student_record_phone_index`（8/08 留的待辦）；
`.mcp.json` 移除專案層 Supabase MCP 已 commit（改走 claude.ai connector）。

**未完成／待辦：**
- 簡訊實測（/admin/sms 發一則給自己）、看板 4 位碼驗收——都要 Jason 本人操作（會真的扣款）
- 蘇郁雅該筆待 Jason 在後台輸入（需要她本人手機號碼）

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

5. **模組化規劃稿入庫**（平行線產出，僅文件）：docs/MODULARIZATION_PLAN.md（16 模組四階段）＋
   ARCHITECTURE.md 現況基準 commit 入庫、HANDOFF 摘要；提醒多線並行下搬檔需排凍結窗口。
   狀態：待 Jason 確認排程，未動程式

**未完成／待辦：**
- Jason 將實際上傳 1shop 訂單檔跑回填（報告有異常截圖回報）；本機 dev DB 尚未套
  20260815100000 migration（下次本機開發前 `npx prisma migrate deploy`）
- 簡訊實測：/admin/sms 發一則給自己驗證（綠色已發送＋MAAC Go 扣款）
- 看板驗收：重輸 4 位碼、連錯 5 次限流測試
- CSP Report-Only 觀察 1–2 週後切正式阻擋
- MAAC Go 送達 webhook（回流逐筆狀態）、會員手機串簡訊名單——待指示
- `.mcp.json` 有一筆別條線留的未 commit 修改（移除 Supabase MCP 設定），待 Jason 決定去留
