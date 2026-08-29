# SPEC-01｜EDM 電子郵件行銷模組優化

## 0. 文件資訊

| 項目 | 內容 |
|---|---|
| 專案 | 希望學院課程平台（course-platform） |
| 模組 | Email Marketing／EDM |
| 文件版本 | v1.0 |
| 建立日期 | 2026-08-29 |
| 文件狀態 | 規劃版；Phase 1 可交付 coding agent 執行，Phase 2–3 需另開子 SPEC |
| 主要讀者 | Claude／Codex 等 coding agent、產品負責人、後續維護者 |
| 唯一真實來源 | 本 SPEC（優化需求與分期）、實際程式碼（既有行為）、`CLAUDE.md`（專案安全鐵則） |
| 現況參考 | `docs/edm-module.md`（內容部分過時，不能單獨作為實作依據） |

### 文件目的

本文件保存 EDM 模組的產品脈絡、既有架構、不可破壞的規則、已知問題、分期方向與第一階段可執行規格。後續將本文件交給沒有對話上下文的 coding agent 時，agent 應能先理解現況，再安全地完成指定階段，而不是重新設計整個模組。

---

## 1. 概述

### 1.1 模組定位

EDM 模組不是單純寄信頁面，而是希望學院的電子郵件發送中樞，涵蓋：

- 行銷推播：招生、活動、內容行銷與舊客喚回。
- 履約通知：已報名學員的課前提醒、上課資訊與場次異動。
- 名單管理：會員、EDM 名單群組、場次報名者、手動名單。
- 郵件內容：推薦範本、自建範本、個人化變數、課程卡與即時預覽。
- 發送控制：測試信、草稿、立即寄送、排程、取消與失敗補寄。
- 合規與信譽：退訂、退信、垃圾信檢舉與 List-Unsubscribe。
- 成效追蹤：送達、開信、點擊、退信、檢舉及成效跟進信。

### 1.2 本次優化目標

1. 先修正會造成管理者誤判的資料口徑與預覽缺陷。
2. 建立清楚、可驗證、可延伸的 EDM 事件與收件人資料基礎。
3. 再提升範本、名單健康、成效分析與日常操作效率。
4. 最後才加入自動化系列信、A/B 測試與影片行銷漏斗。

### 1.3 成功定義

- 管理者看到的預覽、收件人狀態與跟進名單，必須符合實際發送結果。
- 不得因優化而繞過退訂、重複寄送、破壞舊紀錄或改變既有名單解析時點。
- 舊 EDM、舊排程、舊草稿與舊事件資料仍可開啟；無新資料時需合理降級顯示。
- Phase 1 完成後，Phase 2–3 可以在不推翻資料定義的前提下擴充。

---

## 2. 範圍與分期

### 2.1 Phase 1：資料正確性與安全基礎（本 SPEC 的實作範圍）

- 修正履約通知在寄送明細頁的預覽文案。
- 明確區分「預計／嘗試寄送名單」與「供成效跟進使用的有效寄送名單」。
- 防止 API 發送失敗者被誤列為「未開信者」。
- 統一並記錄每位收件人的發送結果，讓明細頁和跟進條件有單一資料來源。
- 更新 EDM 架構文件，使其符合目前五種對象及 MARKETING／NOTICE 規則。
- 補齊純函式測試與本機資料庫回歸測試。

### 2.2 Phase 2：操作效率與分析（只預留，不在本 SPEC 實作）

- 獨立範本管理頁與範本分類／搜尋。
- 名單健康管理：退訂、退信、檢舉、無效格式及長期無互動。
- 逐連結點擊追蹤與 CTA 成效。
- 成效儀表板與可由成效建立名單群組。
- 寄送前檢查清單：變數、空連結、缺少上課碼、收件規模及退訂扣除。

### 2.3 Phase 3：自動化成長功能（只預留，不在本 SPEC 實作）

- 自動化系列信與觸發條件。
- 動態分眾。
- A/B 主旨或內容測試。
- EDM 影片頁與階段式影片漏斗。

### 2.4 Phase 1 明確不做

- 不更換 Resend 或寄件網域。
- 不重做 EDM 編輯器或品牌版型。
- 不改成第三方行銷自動化平台。
- 不加入新角色或改動全站 RBAC。
- 不修改簡訊模組，除非共用 cron 的型別或測試因 EDM 改動必須同步調整。
- 不把 MailGroup 與 Enrollment 合併。
- 不回填無法從既有資料可靠推導的舊收件人成功狀態。
- 不把 OPENED 解讀為真人確實閱讀；Apple／Gmail 隱私與圖片代理造成的限制留到 Phase 2 UI 說明。

---

## 3. 技術環境與不可破壞的約束

### 3.1 既有技術環境

- Mac／Node 開發環境。
- Next.js 16 App Router、React 19、TypeScript。
- Prisma 6、PostgreSQL，Prisma 只管理 `course` schema。
- Supabase Auth；全部會員資料由 `public.profiles` 唯讀取得。
- Vercel 部署與 Cron。
- Resend Batch API 與 Resend webhook。

### 3.2 資料庫鐵則

- 絕不讓 Prisma 管理 `public` 或 `auth` schema。
- 不得對正式 Supabase 執行會寫入的自動測試。
- migration 必須手寫、先在本機驗證，並確認 SQL 不含 `public.` 或 `auth.`。
- 新欄位部署順序必須是 migration 先上、應用程式後上；`findUnique` 未帶 `select` 時 Prisma 會讀取所有純量欄位。
- 歷史 EmailBroadcast 的軟連結設計必須保留，不因群組、場次、課程或來源信被刪除而 cascade 刪除歷史。

### 3.3 Server Action 與權限鐵則

- `"use server"` 檔案只能 export async function；同步 helper、常數、enum-like 對照表放在 `src/lib/`。
- EDM 後台頁與 actions 沿用現有 Editor 權限：page 使用 `pageGuardEditor()`，action 使用 `requireEditor()`。
- webhook 必須先驗 Svix 簽章與時間容忍範圍，再解析及寫入事件。
- cron 必須驗證 `Authorization: Bearer ${CRON_SECRET}`。

### 3.4 不可改變的產品規則

1. `MailGroup` 只是寄信名單；`Enrollment` 才是課程觀看權限。
2. 動態名單在寄出當下解析；MANUAL 名單建立時固定。
3. 所有名單來源必須匯入同一條 email 清理、去重及退訂過濾漏斗。
4. MARKETING 排除 USER、BOUNCE、COMPLAINT。
5. NOTICE 只排除 BOUNCE、COMPLAINT。
6. NOTICE 只允許 SESSION、MANUAL 與 UI 的選取會員；ALL、GROUP、FOLLOWUP 不得標為 NOTICE。
7. 測試信只寄操作管理員，不受一般群發退訂漏斗影響。
8. 群組與場次複選時保留勾選順序；重複 email 的姓名與 `{code}` 由先出現者決定。
9. 排程使用台北時間，需至少晚於當下 60 秒。
10. cron 原子認領與 15 分鐘逾時回收必須保留；逾時不自動重寄。
11. 逐人單獨寄送，不使用 BCC；批次上限、重試及限速規則維持既有行為。

---

## 4. 現況脈絡與資料流

### 4.1 五種發送對象

| `audienceType` | UI 對象 | 來源 | 名單解析時點 |
|---|---|---|---|
| `ALL` | 全部會員 | Supabase profiles | 寄出當下 |
| `GROUP` | 一或多個 EDM 名單群組 | MailGroupMember | 寄出當下 |
| `SESSION` | 一或多個場次報名者 | SessionSignup | 寄出當下 |
| `MANUAL` | 手動貼入／選取會員 | EmailBroadcast.manualRows | 建立時固定 |
| `FOLLOWUP` | 開信、未開信、點擊、開信未點擊 | 來源信與 BroadcastEvent | 寄出當下 |

### 4.2 現行寄送流程

```text
建立表單
  → resolveBroadcastAudience：保存對象描述
  → 草稿／排程／立即寄送
  → executeBroadcast
  → resolveRecipients：寄出當下解析、清理、去重、退訂過濾
  → sendBroadcast：100 封一批、逐人 HTML、Resend Batch API
  → EmailBroadcast 回寫 sent/failed、failedRecipients、recipients
  → Resend webhook 回寫 BroadcastEvent
  → BOUNCED/COMPLAINED 同步進 MailUnsubscribe
```

### 4.3 既有資料模型

- `EmailBroadcast`：郵件內容、對象描述、排程與彙總結果。
- `MailTemplate`：內容範本，不保存對象。
- `MailGroup`／`MailGroupMember`：EDM 靜態群組。
- `MailUnsubscribe`：USER、BOUNCE、COMPLAINT 共用抑制表。
- `BroadcastEvent`：Resend 回流的 DELIVERED、OPENED、CLICKED、BOUNCED、COMPLAINED。

### 4.4 已確認問題

#### P1. 履約通知明細預覽文案錯誤

寄送明細頁呼叫 `buildBroadcastHtml()` 時未傳 `record.messageType`，NOTICE 的畫面預覽會套用 MARKETING footer 文案。實際寄送路徑有傳入，因此這是事後預覽錯誤，不是已寄信件錯誤。

#### P2. `recipients[]` 語意混合

目前 `recipients[]` 寫入退訂過濾後的全部嘗試名單，包含 Resend API 個別失敗者；但它同時被當成「實際寄出名單快照」及 NOT_OPENED 的母集合。API 失敗又沒有 BOUNCED webhook 的人，可能被誤列為未開信者。

#### P3. 文件與實作不一致

`docs/edm-module.md` 仍寫四種對象並聲稱沒有場次對象，但程式與 schema 已支援 SESSION；文件也未完整描述 MARKETING／NOTICE 分流。

#### P4. 事件只記人與類型，沒有連結維度

現有 `BroadcastEvent` 唯一鍵為 `(broadcastId,email,type)`，同一人所有點擊只會留下 CLICKED 一種狀態，無法知道點了哪個網址。這是 Phase 2 問題，Phase 1 不擴充 URL 事件。

---

## 5. Phase 1 資料模型

### 5.1 採用方案：新增逐收件人發送結果表

新增 `EmailBroadcastRecipient`（名稱可依專案命名慣例微調，但不得與 MailGroupMember 混用）：

| 欄位 | 型別 | 規則／用途 |
|---|---|---|
| `id` | String | cuid 主鍵 |
| `broadcastId` | String | 指向 EmailBroadcast 的軟連結，不設 FK |
| `email` | String | 小寫、trim 後的合法 email |
| `name` | String? | 寄送當下使用的姓名快照 |
| `status` | String | `PENDING`／`ACCEPTED`／`FAILED` |
| `providerMessageId` | String? | Resend 回傳的單封 message id；有值代表 provider 接受 |
| `failureReason` | String? | API／網路／provider 個別失敗原因 |
| `createdAt` | DateTime | 建立時間 |
| `updatedAt` | DateTime | 最後更新時間 |

索引與唯一規則：

- `@@unique([broadcastId, email])`
- `@@index([broadcastId, status])`
- 不設 EmailBroadcast FK，沿用歷史紀錄軟連結慣例。

### 5.2 狀態定義

- `PENDING`：已解析為本次可寄對象，但尚未取得 provider 結果。
- `ACCEPTED`：Resend Batch API 回傳該筆 message id，代表 provider 已接受；不等同已送達。
- `FAILED`：Resend 未接受、批次請求最終失敗或該筆沒有 message id。
- DELIVERED／OPENED／CLICKED／BOUNCED／COMPLAINED 仍由 `BroadcastEvent` 表示，不複製到 recipient status。

### 5.3 舊欄位相容策略

- 保留 `EmailBroadcast.recipients[]`，不可在 Phase 1 刪除或改型別。
- 新寄送完成後，`recipients[]` 改為保存 `ACCEPTED` 的 email，供既有頁面與 FOLLOWUP 相容使用。
- 新表保存完整 PENDING／ACCEPTED／FAILED 結果，作為新明細頁的單一資料來源。
- 舊紀錄沒有 recipient rows 時，繼續用 `recipients[]`、`failedRecipients` 與 `BroadcastEvent` 降級顯示，並標示為舊資料；不得猜測或回填不存在的 provider 結果。
- `failedRecipients` 暫時保留並同步寫入，確保既有補寄功能相容；Phase 2 再評估移除。

### 5.4 交易與中斷策略

- 在呼叫 Resend 前，以 `createMany({ skipDuplicates: true })` 建立 PENDING rows。
- provider 回應後更新相對應 rows 為 ACCEPTED 或 FAILED。
- 若 serverless 在 provider 已接受但尚未完成資料庫回寫時中斷，仍存在無法完全消除的不確定區間；不得因此自動重寄 PENDING。
- cron 逾時回收仍標記 EmailBroadcast 為 FAILED，管理員自行判斷，不自動重送。

---

## 6. 角色與權限

| 操作 | 未登入 | 學員 | 總教練唯讀 | Editor（管理員／操作人員） | Cron／Webhook |
|---|---:|---:|---:|---:|---:|
| 查看 EDM 後台與明細 | 否 | 否 | 依現有 page guard | 是 | 不適用 |
| 建立、編輯、測試、排程、寄送 | 否 | 否 | 否 | 是 | 不適用 |
| 查看逐人狀態 | 否 | 否 | 依現有 page guard | 是 | 不適用 |
| 執行到期排程 | 否 | 否 | 否 | 否 | CRON_SECRET |
| 回寫 Resend 事件 | 否 | 否 | 否 | 否 | Svix 驗簽成功 |
| 公開退訂 | 有效 token／標準 one-click request | 同左 | 同左 | 同左 | 不適用 |

Phase 1 不新增或調整角色；所有新頁面資料讀取必須沿用現有 Editor guard。

---

## 7. 相依與執行順序

coding agent 必須按以下順序執行，不得跳過資料相容與測試直接改 UI：

1. 閱讀本 SPEC、`CLAUDE.md`、現有 `docs/edm-module.md`。
2. 盤點並列出會修改的檔案；確認工作樹既有變更，不覆蓋使用者修改。
3. 加入 Prisma model 與手寫 migration，先驗證只操作 `course` schema。
4. 擴充 `sendBroadcast()` 的結果，使成功項目能回傳 email 對應的 provider message id。
5. 修改 `executeBroadcast()` 建立及更新逐人發送結果，並把 `recipients[]` 收斂為 ACCEPTED 名單。
6. 修改 FOLLOWUP 的 NOT_OPENED 母集合：新資料使用 ACCEPTED；舊資料才退回 `recipients[]`。
7. 修改明細頁，優先讀取新 recipient rows，舊紀錄降級顯示。
8. 修正 NOTICE 預覽必須傳入 `record.messageType`。
9. 補齊測試並執行回歸。
10. 更新 EDM 架構文件，最後才做 lint、typecheck、build。

---

## 8. Phase 1 任務清單

### T1. 修正 NOTICE 明細預覽

- 在寄送明細頁重建 HTML 時傳入 `record.messageType`。
- 預覽的 NOTICE footer 必須顯示「取消訂閱只停止電子報，上課通知仍會寄送」的既有語意。
- MARKETING footer 維持原文案。

### T2. 新增逐收件人結果資料模型

- 依第 5 節建立 model 與 migration。
- migration 不回填推測資料，只建立空表、唯一鍵與索引。
- migration SQL 不得包含 `public.`、`auth.`、DROP SCHEMA 或跨 schema 操作。

### T3. 擴充 Resend 寄送結果

- `sendBroadcast()` 必須能將每個輸入 recipient 對應到：ACCEPTED + message id，或 FAILED + reason。
- 不可只靠陣列長度假設成功；仍需逐筆檢查 `data[j].id`。
- 批次整體失敗時，該批所有 recipient 都標 FAILED，原因一致且可讀。
- 保留目前 100 封批次、600ms 間隔、429／5xx／網路錯誤重試規則。

### T4. 回寫逐人結果與相容欄位

- `executeBroadcast()` 在寄送前建立 PENDING rows。
- 寄送後分別回寫 ACCEPTED／FAILED。
- `EmailBroadcast.sentCount` 等於 ACCEPTED 數。
- `EmailBroadcast.failedCount` 等於 FAILED 數。
- `EmailBroadcast.recipients[]` 只寫入 ACCEPTED emails。
- `failedRecipients` 繼續同步 FAILED 子集，讓補寄功能不退化。
- 若全部 FAILED，EmailBroadcast 為 FAILED；至少一筆 ACCEPTED 時沿用目前 SENT 行為。

### T5. 修正跟進信名單口徑

- 新紀錄 NOT_OPENED 只從 ACCEPTED email 集合扣除 OPENED 與 BOUNCED。
- FAILED 不得進入 OPENED、NOT_OPENED、CLICKED、OPENED_NOT_CLICKED 任一跟進名單。
- 舊紀錄沒有 recipient rows 時，沿用既有 `recipients[]` 邏輯。
- MARKETING 跟進信仍需再走當下退訂過濾。

### T6. 改善明細頁逐人狀態

新資料優先顯示：

- API 失敗：FAILED 與原因。
- Provider 已接受、尚無 webhook：ACCEPTED／等待回報。
- DELIVERED、OPENED、CLICKED：依既有最高事件呈現。
- BOUNCED、COMPLAINED：終態並顯示原因（若有）。

舊資料：

- 維持既有推導方式。
- 顯示「舊寄送紀錄，無逐筆 API 結果」提示。
- 不得把所有沒有 webhook 的舊收件人直接判為失敗。

### T7. 更新文件

更新 `docs/edm-module.md`，至少包含：

- 五種發送對象，補上 SESSION。
- MARKETING／NOTICE 與允許對象。
- `{code}` 與場次名單的關係。
- `EmailBroadcastRecipient` 的資料語意。
- `recipients[]` 新舊相容策略。
- 跟進信只以 provider 已接受者為母集合。
- 更新檔案地圖與測試指令。

並確認內容與 `CLAUDE.md` 不衝突；若需修改 `CLAUDE.md`，只補充必要摘要，不複製整份模組文件。

### T8. 測試與驗證

- 新增或擴充純函式／mock Resend 測試，覆蓋逐筆成功、部分失敗、整批失敗與重試後成功。
- 擴充本機 EDM 資料庫測試，覆蓋 NOTICE／MARKETING 退訂分流及跟進名單。
- 驗證舊 EmailBroadcast 無 recipient rows 時明細頁仍能開啟。
- 執行 `pnpm check:actions`、TypeScript、lint 與 build。

---

## 9. 驗收標準

| 編號 | 驗收情境 | 預期結果 | 對應任務 |
|---|---|---|---|
| AC-01 | 開啟 NOTICE 寄送明細 | 預覽 footer 為履約通知文案，MARKETING 文案不變 | T1 |
| AC-02 | 3 人寄送，Resend 回 2 個 id、1 個錯誤 | 2 ACCEPTED、1 FAILED；sentCount=2、failedCount=1 | T2–T4 |
| AC-03 | 上述部分失敗寄送完成 | `recipients[]` 只有 2 個 ACCEPTED email；failedRecipients 只有失敗者 | T4 |
| AC-04 | 對上述來源建立 NOT_OPENED 跟進 | 失敗者不在跟進名單；已開信者被扣除 | T5 |
| AC-05 | 全批次 5xx 且重試用盡 | 該批所有人 FAILED，有原因；EmailBroadcast=FAILED；不自動重寄 | T3–T4 |
| AC-06 | 429 後重試成功 | 最終為 ACCEPTED，只有一份 recipient row，不重複計數 | T2–T4 |
| AC-07 | webhook 重送同一事件 | BroadcastEvent 仍只有一筆，逐人狀態不重複 | T6 |
| AC-08 | 開啟改版前的舊寄送 | 頁面正常、顯示舊資料提示、不錯誤回填狀態 | T6 |
| AC-09 | MARKETING 名單含 USER／BOUNCE／COMPLAINT | 三者全排除 | T5、T8 |
| AC-10 | NOTICE 名單含 USER／BOUNCE／COMPLAINT | USER 可寄，BOUNCE／COMPLAINT 排除 | T5、T8 |
| AC-11 | GROUP／ALL 嘗試標 NOTICE | server action 擋下，不可靜默降級或寄出 | T8 |
| AC-12 | 文件檢查 | 文件列出五種對象，不再聲稱沒有 SESSION | T7 |
| AC-13 | migration 靜態檢查 | 不含 `public.`、`auth.`、DROP SCHEMA | T2 |
| AC-14 | 專案回歸 | `pnpm check:actions`、typecheck、lint、build 全部通過 | T8 |

---

## 10. 非功能需求、風險與待確認

### 10.1 非功能需求

- 安全：API key、Supabase secret、webhook secret 不得進 client bundle 或 log。
- 冪等：同一 broadcast/email 不得產生重複 recipient row；webhook 重送不得重複事件。
- 效能：recipient rows 應批次建立與更新，禁止數百人時逐人串行查詢資料庫。
- 可觀測性：錯誤 log 可含 broadcast id、批次與數量，不得輸出 API key 或完整郵件本文。
- 可維護性：狀態常數與純 helper 放 `src/lib/email/`，不可從 `"use server"` 檔 export 同步值。
- 向後相容：舊紀錄、舊草稿與舊排程必須可讀；排程中紀錄在部署跨版本時不可因欄位缺失 500。

### 10.2 已知殘餘風險

- Resend 接受郵件不代表已送達，正式送達仍以 webhook DELIVERED 為準。
- provider 已接受但應用程式在回寫前中斷，可能留下 PENDING；為避免重複寄送，不可自動重寄。
- OPENED 會受圖片代理與隱私保護影響，不能當成精準真人閱讀率。
- Phase 1 尚無逐 URL 點擊，因此 CLICKED 只能代表至少點過一次。

### 10.3 待產品負責人確認（不阻擋 Phase 1）

1. Phase 2 儀表板主要決策指標要以「送達率＋點擊率」為主，或仍突出開信率？
   - 建議：送達率與點擊率為主，開信率標註為參考值。
2. Phase 2 是否需要匯出逐人 CSV？
   - 建議：需要，方便用 Google Sheet 進一步分析；匯出需受 Editor 權限保護。
3. Phase 3 自動化系列信的第一個場景為何？
   - 建議：先做「活動／課程報名後的課前通知系列」，其名單與履約規則最明確。
4. PENDING 超過多久在 UI 標示為「結果不確定」？
   - 建議：15 分鐘，與現有 cron 卡死回收門檻一致；只標示，不自動重寄。

---

## 11. 給 coding agent 的執行指示

1. 開工前先閱讀本 SPEC、`CLAUDE.md`、`docs/edm-module.md` 與下列核心檔案：
   - `prisma/schema.prisma`
   - `src/lib/email/dispatch.ts`
   - `src/lib/email/broadcast.ts`
   - `src/lib/email/audience.ts`
   - `src/lib/email/followup.ts`
   - `src/actions/admin.ts` 的 broadcast/group 區段
   - `src/app/(admin)/admin/broadcast/**`
   - `src/app/api/cron/broadcast/route.ts`
   - `src/app/api/webhooks/resend/route.ts`
2. 只執行 Phase 1；Phase 2–3 不得先做或順手加欄位。
3. 若本 SPEC 與程式現況衝突，先停止實作並回報「衝突位置、現行行為、兩個可選方案與建議」，不得自行選擇會改變產品規則的方案。
4. 保留工作樹內既有使用者變更；禁止 destructive git 操作。
5. 使用 `apply_patch` 編輯；migration 手寫且先做 schema 安全檢查。
6. 不連正式資料庫跑寫入測試，不寄真實 EDM；Resend 測試使用 mock endpoint。
7. 完成後交付：變更摘要、資料遷移說明、測試證據、已知限制、尚未執行的 Phase 2–3。
8. 若驗收項目沒有自動測試，必須提供可重現的人工驗收步驟；不得只說「應該可以」。

---

## 附錄 A：核心檔案地圖

| 檔案 | 職責 |
|---|---|
| `src/lib/email/dispatch.ts` | 名單解析、去重、退訂過濾、執行寄送、cron 處理 |
| `src/lib/email/broadcast.ts` | Resend Batch API、品牌 HTML、逐人寄送結果 |
| `src/lib/email/render-content.ts` | EDM 內容語法與合併變數 |
| `src/lib/email/audience.ts` | 群組／場次 audience helper 與預覽型別 |
| `src/lib/email/followup.ts` | 跟進條件常數 |
| `src/lib/email/unsubscribe.ts` | 退訂 token 與 URL |
| `src/actions/admin.ts` | 群發、草稿、排程、範本、補寄與群組 actions |
| `src/app/(admin)/admin/broadcast/` | EDM 表單、紀錄、明細、編輯與名單群組 UI |
| `src/app/api/cron/broadcast/route.ts` | EDM／簡訊共用排程入口 |
| `src/app/api/webhooks/resend/route.ts` | Resend 事件、退信與檢舉回寫 |
| `src/app/api/unsubscribe/route.ts` | 一鍵退訂入口 |
| `prisma/schema.prisma` | EDM 資料模型 |

## 附錄 B：交付 Claude 的建議提示詞

```text
請先完整閱讀 docs/specs/SPEC-01-EDM模組優化.md 與 CLAUDE.md。
本次只執行 SPEC 的 Phase 1，依第 7 節順序與第 8 節任務實作，逐條對照第 9 節驗收標準。
開工前先回報：你理解的既有資料流、預計修改的檔案、migration 方案、測試方案，以及你發現的規格／程式衝突。
未經確認不得擴張到 Phase 2–3，也不得對正式資料庫寫入或寄送真實 EDM。
完成後提供變更摘要、migration 安全檢查、測試輸出與未完成項目。
```
