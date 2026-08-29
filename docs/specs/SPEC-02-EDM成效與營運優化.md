# SPEC-02｜EDM 成效與營運優化（Phase 2）

## 0. 文件資訊

| 項目 | 內容 |
|---|---|
| 專案 | 希望學院課程平台（course-platform） |
| 模組 | Email Marketing／EDM Phase 2 |
| 版本 | v1.0 |
| 日期 | 2026-08-29 |
| 狀態 | 已確認，可執行 |
| 上游規格 | `docs/specs/SPEC-01-EDM模組優化.md` |
| 主要讀者 | Coding agent、產品負責人、後續維護者 |

### 已確認產品決策

1. 儀表板以送達率與點擊率為主要指標；開信率保留，但明確標示為參考值。
2. 提供逐人、逐連結 CSV，格式需能直接用 Google Sheet 開啟分析。
3. Phase 2 完成五項：逐連結追蹤、成效儀表板、名單健康、範本管理、寄送前檢查。

---

## 1. 概述

Phase 1 已建立 `EmailBroadcastRecipient`，能區分 provider 接受、API 失敗與不確定結果。Phase 2 在這個可信基礎上，讓管理者能回答：

- 哪封 EDM 真的送達、被點擊？
- 收件人點了哪一個 CTA？
- 哪些地址已退訂、退信、檢舉或長期無互動？
- 如何把成效名單匯出或存成下一次寄送群組？
- 寄出前是否有空變數、錯誤連結、缺上課碼或其他風險？
- 常用範本如何集中管理，而不是塞在群發首頁？

成功定義：管理者能在後台完成「檢查 → 寄送 → 分析 → 匯出／存群組 → 再行銷」閉環，不需要直接查資料庫。

---

## 2. 範圍與明確不做

### 2.1 本期範圍

1. 逐連結點擊事件。
2. EDM 成效總覽與單封連結分析。
3. 逐人／逐連結 CSV 匯出。
4. 依成效條件存成靜態 MailGroup。
5. 名單健康管理頁。
6. 獨立範本管理頁、搜尋、新增、編輯、複製、刪除。
7. 寄送前檢查清單與必要阻擋。

### 2.2 明確不做

- 不做 Phase 3 自動化系列信、動態分眾、A/B 測試。
- 不做自建 click redirect；沿用 Resend tracking webhook。
- 不保存 clicked payload 的 IP 或 user agent。
- 不把開信率當精準真人閱讀率。
- 不自動刪除長期無互動者、不自動解除 USER 退訂。
- 不修改 Enrollment 或課程觀看權限。
- 不更換 Resend、寄件網域或現有退訂機制。

---

## 3. 技術環境與約束

- 沿用 SPEC-01 與 `CLAUDE.md` 全部安全鐵則。
- Prisma 只操作 `course` schema；migration 手寫且不得含 `public.`／`auth.`。
- 後台讀寫沿用 Editor 權限；CSV route 也必須 server-side 驗證 Editor。
- webhook 必須維持 Svix 驗簽、時間容忍與冪等。
- Resend 官方 `email.clicked` payload：`data.click.link` 與 `data.click.timestamp`。只保存這兩項必要資料。
- CSV 使用 UTF-8 BOM，避免中文在試算表中亂碼；不得包含姓名／Email 以外的敏感資料。
- 舊事件沒有 URL 時仍可顯示整體 CLICKED，不得偽造逐連結資料。

---

## 4. 相依與執行順序

1. 點擊資料模型與 webhook。
2. 成效查詢 helper、儀表板與單封連結分析。
3. CSV 匯出與成效存群組。
4. 名單健康頁。
5. 範本管理頁。
6. 寄送前檢查。
7. 測試、文件與完整 build。

---

## 5. 資料模型

### 5.1 `BroadcastLinkEvent`

| 欄位 | 型別 | 說明 |
|---|---|---|
| `id` | String | cuid |
| `broadcastId` | String | EmailBroadcast 軟連結，不設 FK |
| `email` | String | 小寫 email |
| `url` | String @db.Text | 被點擊的完整 URL |
| `urlHash` | String | URL 的 SHA-256；供安全唯一索引，避免長 URL 超過 PostgreSQL index row 上限 |
| `firstClickedAt` | DateTime | 第一次點擊時間 |
| `lastClickedAt` | DateTime | 最後一次點擊時間 |
| `clickCount` | Int | webhook 收到的點擊次數 |
| `createdAt` | DateTime | 建立時間 |
| `updatedAt` | DateTime | 更新時間 |

規則：

- `@@unique([broadcastId,email,urlHash])`；應用層以完整 URL 計算 SHA-256。
- `@@index([broadcastId,lastClickedAt])`
- webhook 用 upsert：首次 create；重送或再次點擊 update `lastClickedAt` 並 increment。
- Svix 本身可能重送同一 webhook。為避免重送灌高 clickCount，另保存 webhook id：新增 `WebhookReceipt`，`svixId @unique`、`eventType`、`createdAt`。先 create receipt，唯一鍵衝突即回 `{ duplicate: true }`，不再更新事件。
- `WebhookReceipt` 只保存技術識別碼，不保存 payload；可定期清理，但本期不做清理 job。

### 5.2 現有資料沿用

- `BroadcastEvent`：唯一人是否 DELIVERED／OPENED／CLICKED 等。
- `EmailBroadcastRecipient`：provider 接受與失敗母集合。
- `MailUnsubscribe`：USER／BOUNCE／COMPLAINT 健康狀態。
- `MailTemplate`：Phase 2 不強制加欄位；搜尋與管理先使用既有 name、subject、courseId、updatedAt。

---

## 6. 角色與權限

| 功能 | Editor | 總教練唯讀 | 學員／未登入 | Webhook |
|---|---:|---:|---:|---:|
| 成效儀表板 | 是 | 依現有 page guard | 否 | 否 |
| CSV 匯出 | 是 | 否 | 否 | 否 |
| 存成名單群組 | 是 | 否 | 否 | 否 |
| 名單健康管理 | 是 | 依現有 page guard | 否 | 否 |
| 範本 CRUD | 是 | 否 | 否 | 否 |
| 回寫 link event | 否 | 否 | 否 | Svix 驗簽成功 |

---

## 7. 任務清單

### T1. 逐連結 webhook

- 新增 `BroadcastLinkEvent`、`WebhookReceipt` 與 migration。
- 擴充 Resend webhook event data 型別，安全解析 `click.link`、`click.timestamp`。
- URL 必須是合法 http/https，長度上限 4096；非法值只保留既有 CLICKED，不寫 link event。
- timestamp 無效時使用 webhook 接收時間。
- webhook id 重送不得增加 clickCount。
- 不記 IP、user agent。

### T2. 成效儀表板

新增 `/admin/broadcast/analytics`：

- 期間：最近 7／30／90 天，預設 30 天。
- 指標：已接受、送達、點擊、退信、檢舉；開信為參考。
- 比率分母為 `sentCount`／ACCEPTED；分母 0 顯示 `—`。
- 清楚標示「開信受 Apple/Gmail 隱私機制影響，僅供參考」。
- 寄送列表顯示主旨、寄送時間、對象、接受、送達率、點擊率、開信參考、退信率。
- 不把 DRAFT／SCHEDULED／CANCELED 納入成效。

### T3. 單封逐連結分析

在既有 `/admin/broadcast/[id]` 增加：

- 每個 URL 的唯一點擊人數、總點擊次數、首次／最後點擊。
- URL 可安全截斷顯示，完整值放 title／可複製。
- 無 link event 的舊信顯示「舊資料只有是否點擊，無逐連結明細」。

### T4. CSV 匯出

新增 server route：

- `/api/admin/broadcast/[id]/recipients.csv`
- `/api/admin/broadcast/[id]/links.csv`

逐人欄位：Email、姓名、Provider狀態、送達、開信、點擊、退信、檢舉、失敗原因。

逐連結欄位：URL、Email、首次點擊、最後點擊、點擊次數。

規則：Editor guard、UTF-8 BOM、RFC 4180 escaping、檔名包含日期與 broadcast id，不輸出 IP/user agent。

### T5. 成效存成名單群組

單封明細提供條件：已送達、已點擊、未點擊、退信以外未互動。

- 只從 ACCEPTED 母集合解析。
- 存的是當下靜態快照，沿用 `MailGroup` 同名合併與 email 去重。
- MARKETING 後續寄送仍會再次過濾退訂。
- 0 人時不可建立。

### T6. 名單健康管理

新增 `/admin/broadcast/health`：

- 摘要：USER 退訂、BOUNCE、COMPLAINT、PENDING 超過 15 分鐘、最近 90 天 ACCEPTED 但無 CLICKED。
- 可依狀態篩選與搜尋 email。
- 顯示來源、原因、建立時間、最近寄送／最近互動（能可靠取得才顯示）。
- 可匯出目前篩選 CSV。
- 本期不提供直接刪除抑制紀錄；避免管理員誤讓退信／檢舉地址重新進群發。

### T7. 範本管理

新增 `/admin/broadcast/templates`：

- 搜尋名稱／主旨。
- 列表顯示名稱、主旨、關聯課程、最後更新時間、最後編輯者。
- 新增、編輯、複製、刪除。
- 同名儲存仍採覆蓋，但 UI 必須二次確認；複製預設名稱為「原名－副本」，重名時自動加序號。
- 群發首頁保留快速載入區，但提供「管理全部範本」入口。

### T8. 寄送前檢查

新增純函式 `inspectBroadcastDraft()`，前端即時顯示錯誤／警告：

阻擋錯誤：

- 主旨空白。
- 正式寄送內文空白。
- Markdown 連結／圖片為空或非 http/https。
- 內文含未支援的 `{...}` 變數。
- 使用 `{code}` 且 SESSION 可寄者不是全數有 code。
- NOTICE 未勾確認或 audience 不允許。

非阻擋警告：

- 沒有 CTA 連結。
- 主旨超過 60 個字元。
- 內文仍含常見 placeholder（日期、地點、請填寫、TODO）。
- 收件人 0、無 email、重複、退訂扣除等沿用 audience preview 顯示。

Server Action 必須重驗阻擋規則；不能只靠 client UI。

### T9. 文件與測試

- 更新 `docs/edm-module.md` 與 CLAUDE.md 檔案地圖／測試指令。
- webhook 測試：合法 clicked、非法 URL、重送冪等、同人再次點擊。
- analytics helper 測試：分母 0、舊資料、FAILED 排除。
- CSV 測試：中文、逗號、雙引號、換行與公式注入防護。
- preflight 測試：所有阻擋與警告。
- migration、typecheck、lint、Server Action check、production build 全通過。

---

## 8. 驗收標準

| 編號 | 驗收 |
|---|---|
| AC-01 | 同一個 svix-id 重送不增加任何事件或 clickCount |
| AC-02 | 同一人同 URL 不同 webhook 點兩次：unique=1、clickCount=2、lastClickedAt 更新 |
| AC-03 | clicked 非 http/https：保留 CLICKED，無 link event |
| AC-04 | 儀表板 30 天只納入完成寄送，送達／點擊率分母為 ACCEPTED |
| AC-05 | 開信率旁有隱私限制提示，且不是主要 KPI |
| AC-06 | 舊信沒有 URL 明細時不報錯、不偽造資料 |
| AC-07 | 逐人與逐連結 CSV 可由 Google Sheet 正常開啟中文、逗號與換行 |
| AC-08 | CSV route 未登入／非 Editor 無法下載 |
| AC-09 | 成效存群組只含 ACCEPTED 且符合條件者；0 人被阻擋 |
| AC-10 | 健康頁不提供解除退訂／退信／檢舉的危險按鈕 |
| AC-11 | 範本可搜尋、新增、編輯、複製、刪除；同名覆蓋有確認 |
| AC-12 | 所有 preflight 阻擋規則在 client 與 server 一致 |
| AC-13 | `{code}` 覆蓋不足時正式寄送被阻擋，測試信可預覽但顯示警告 |
| AC-14 | migration 不含 public/auth/破壞性 schema SQL |
| AC-15 | mock／DB 測試、typecheck、lint、check:actions、build 全通過 |

---

## 9. 非功能需求與 Agent 指示

- 大量統計避免 N+1；優先 groupBy、批次 query、Map 聚合。
- 儀表板單次查詢上限 90 天，不做無界線全表掃描。
- CSV 內容防試算表公式注入：以 `= + - @` 開頭的儲存格前置單引號。
- URL 顯示與 CSV 均視為不可信輸入；React 輸出不得使用 dangerouslySetInnerHTML。
- 管理頁沿用既有 Tailwind 視覺，不引入新 UI 套件。
- 工作樹可能有其他 agent 變更；不得覆蓋、reset 或刪除非本任務內容。
- 只完成 Phase 2，不順手實作 Phase 3。
- 發現規格與程式衝突時，先列出衝突與建議，不得默默改變退訂、權限、排程或名單解析規則。

### 官方外部契約

- Resend `email.clicked`：https://resend.com/docs/webhooks/emails/clicked
- 已確認欄位：`data.click.link`、`data.click.timestamp`；本系統不保存 `ipAddress`、`userAgent`。
