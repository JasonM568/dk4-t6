# SPEC-03｜學員資料庫維護（編輯、課程紀錄維護與刪除）

## 0. 文件資訊

| 欄位 | 內容 |
|---|---|
| 文件版本 | v0.3 Implemented |
| 建立日期 | 2026-08-29 |
| 模組 | 學員資料庫 `/admin/students` |
| 需求來源 | 現行程式、資料模型、CLAUDE.md、2026-08-29 名單分類與課程開通討論 |
| 實作對象 | Claude／Coding Agent |
| 狀態 | 已實作安全永久刪除 |

### 已確認需求

1. 後台管理者需要編輯學員資料。
2. 後台管理者需要刪除錯誤的學員資料。
3. 既有匯入、訂單同步、搜尋、課名歸戶與分眾功能必須保持可用。
4. 歷史學員是數量最大的未註冊族群，少部分仍在舊官網登入觀看影片。
5. 潛在名單是未上過正式課程、但參加讀冊會／活動或填寫頻率意識地圖問卷的人。
6. 學員頁必須同時看得見上課履歷與新平台影片權限摘要，但 Enrollment 仍由 SPEC-06 擁有。

### 建議決策（實作前確認）

1. 同時提供「刪除單筆上課紀錄」與「永久刪除整位學員」，避免為刪錯課程而刪整張記錄卡。
2. 永久刪除整位學員採二次確認，且必須輸入學員姓名；無姓名時輸入手機或 `DELETE`。
3. 永久刪除只處理 `StudentRecord` 與其 `StudentCourseHistory`，不得刪除 Supabase Auth 帳號、會員資料、訂單、Enrollment、場次報名或 EDM 紀錄。
4. 所有修改與刪除建立稽核紀錄；刪除稽核保存刪除前快照，但不提供自動還原。

## 1. 概述

### 1.1 現況

`/admin/students` 現在提供：

- 以手機、姓名或 Email 搜尋最近 100 位學員。
- CSV／XLSX 匯入學員與上課紀錄。
- 從 1shop 訂單及既有系統同步歷史紀錄。
- 顯示學員主檔與上課紀錄卡。
- 課名歸戶與分眾圈人。

目前沒有主檔 CRUD、上課紀錄 CRUD 或刪除確認流程。資料錯誤時只能重新匯入補空值，無法在後台修正既有姓名、手機、Email 或錯誤課程。

### 1.2 目標

建立安全、可追溯的維護流程，讓 Editor／Admin 可以：

- 開啟單一學員詳細頁。
- 編輯姓名、手機與 Email。
- 新增、編輯及刪除單筆上課紀錄。
- 永久刪除錯誤建立的整位學員及其歷史課程。
- 在任何破壞性操作前看清楚影響範圍。
- 區分正式課程履歷與讀冊會／問卷等潛在接觸紀錄。
- 標示舊官網觀看狀態，支援日後轉移追蹤。

### 1.3 成功指標

- 一般資料修正不需要操作資料庫或重新匯入。
- 重複手機、非法 Email 與誤刪能被後端守門阻擋。
- 學員刪除不影響會員登入、訂單、觀看權限及其他模組歷史資料。
- 每次寫入操作都有操作者、時間與變更內容可追溯。

## 2. 範圍與明確不做

### 2.1 本期範圍

1. 學員詳細／維護頁 `/admin/students/[id]`。
2. 編輯 `StudentRecord.name`、`phone`、`email`。
3. 新增、編輯、刪除 `StudentCourseHistory`。
4. 永久刪除 `StudentRecord`，沿用現有 Cascade 刪除其 histories。
5. 修改／刪除稽核紀錄。
6. 搜尋結果的「查看／編輯」入口與刪除影響提示。
7. Server Action 權限、輸入驗證、衝突處理與自動化測試。
8. 潛在接觸紀錄與舊官網狀態。
9. 提供跨模組唯讀摘要 DTO，供 SPEC-10 顯示帳號、課程履歷與影片權限。
10. Full Admin 可封存／解除封存學員記錄卡；一般列表預設排除封存資料，另有封存檢視。

### 2.2 明確不做

- 不刪除或編輯 Supabase `auth.users`／`public.profiles`。
- 不刪除 `Enrollment`、`PendingEnrollment`、訂單、付款、場次報名或 EDM 歷史。
- 不把兩位學員合併成一位；合併需另立 SPEC。
- 不批次刪除學員。
- 不以 Email 改為唯一識別鍵。
- 不允許使用者自行修改學員歷史。
- 不提供稽核快照的一鍵還原。
- 不因潛在名單參加活動而建立 `Enrollment` 或正式課程履歷。
- 不在本模組修改新平台影片權限或舊官網帳密。
- 封存不刪除 `StudentRecord`、histories、engagements 或已認領的會員帳號。

## 3. 技術環境與約束

- Next.js 16 App Router、React、TypeScript、Server Actions。
- Prisma 6、PostgreSQL `course` schema。
- 後台權限沿用 `pageGuardEditor()` 與 `requireEditor()`；不得只靠前端隱藏按鈕。
- 手機輸入統一經 `normalizeMobile()`；空值保存為 `null`。
- Email 統一 `trim().toLowerCase()`；空值保存為 `null`。
- 手機仍是主要識別鍵且資料庫唯一；Email 不唯一，因夫妻／親子可能共用信箱。
- 姓名不同不得自動併卡；不得改壞 `upsertStudent()` 的同行者鐵則。
- 表單回傳可讀的繁體中文錯誤，不把 Prisma 例外直接顯示給使用者。
- 寫入完成後 revalidate 學員列表、詳細頁與分眾頁。

## 4. 相依與執行順序

1. 建立稽核資料模型與 migration。
2. 建立共用輸入驗證及資料快照格式。
3. 實作 Server Actions 與交易。
4. 建立學員詳細／編輯頁。
5. 建立上課紀錄新增、編輯與刪除介面。
6. 建立整位學員永久刪除介面。
7. 更新學員列表入口及模組文件。
8. 執行 DB 測試、權限檢查、typecheck、lint 與 production build。

## 5. 資料模型

### 5.1 既有模型沿用

`StudentRecord`

- `id`
- `phone`：nullable unique，主要識別鍵。
- `email`：nullable、非 unique。
- `name`
- `claimedUserId`／`claimedAt`：會員認領資訊，本期不可由維護表單修改。
- `histories`：刪除主檔時由既有 `onDelete: Cascade` 一併刪除。

`StudentCourseHistory`

- `courseName`
- `attendedAt`
- `source`
- `note`

### 5.2 `StudentRecord` 補充欄位

| 欄位 | 型別 | 說明 |
|---|---|---|
| `legacyAccessStatus` | String | `NONE`、`ACTIVE`、`TO_MIGRATE`、`MIGRATED`、`UNKNOWN`；預設 `UNKNOWN` |
| `legacyNote` | Text nullable | 舊官網人工核對備註，不保存密碼 |

### 5.3 新增 `StudentEngagement`

用來保存尚不構成正式上課履歷的接觸事件；不得塞入 `StudentCourseHistory`。

| 欄位 | 型別 | 說明 |
|---|---|---|
| `id` | String cuid | 主鍵 |
| `studentId` | String | FK `StudentRecord`，刪除主檔時 Cascade |
| `type` | String | `BOOK_CLUB`、`FREQUENCY_MAP`、`SEMINAR`、`EVENT`、`OTHER` |
| `title` | String | 活動／問卷名稱 |
| `occurredAt` | DateTime nullable | 發生日期 |
| `source` | String nullable | 匯入、表單或人工來源 |
| `sourceRef` | String nullable | 外部事件 id；有值時供冪等去重 |
| `note` | Text nullable | 內部備註 |
| `createdAt` | DateTime | 建立時間 |

索引至少包含 `studentId`、`type`；同一來源可用 `(source, sourceRef, studentId)` 應用層冪等，是否建立 DB unique 應依來源 ref 穩定性決定。

### 5.4 新增 `StudentDataAuditLog`

| 欄位 | 型別 | 說明 |
|---|---|---|
| `id` | String cuid | 主鍵 |
| `studentId` | String nullable | 軟連結；學生刪除後仍保留原 id |
| `historyId` | String nullable | 單筆課程操作時保存原 id |
| `action` | String | 原有 action，另含 `ENGAGEMENT_CREATE/UPDATE/DELETE`、`LEGACY_STATUS_UPDATE` |
| `actorEmail` | String nullable | 操作者 Email |
| `beforeJson` | Json nullable | 修改／刪除前快照 |
| `afterJson` | Json nullable | 新增／修改後快照 |
| `createdAt` | DateTime | 操作時間 |

約束：稽核表不得對 `StudentRecord` 或 history 設 Cascade FK，否則刪除後會失去稽核資料。`beforeJson`／`afterJson` 不保存任何密碼或金流資料。

## 6. 角色與權限

| 操作 | Viewer | Editor | Admin |
|---|---:|---:|---:|
| 查看學員與歷史 | 依現行規則 | 是 | 是 |
| 編輯學員主檔 | 否 | 是 | 是 |
| 新增／編輯／刪除單筆課程 | 否 | 是 | 是 |
| 永久刪除整位學員 | 否 | 是 | 是 |
| 查看稽核紀錄 | 否 | 是 | 是 |

每個 Page 與 Server Action 都必須獨立驗證權限。不得信任從瀏覽器提交的 studentId、historyId 或確認文字。

## 7. 任務清單

### T1. 學員詳細頁

- 新增 `/admin/students/[id]`。
- 顯示姓名、手機、Email、建立／更新時間、會員認領狀態及所有 histories。
- 查無 id 回傳 `notFound()`。
- 列表每張記錄卡新增「查看／編輯」。

### T2. 編輯學員主檔

- 姓名可空白；非空白先 trim。
- 手機可空白；非空白必須通過 `normalizeMobile()`。
- Email 可空白；非空白必須通過基本 Email 格式驗證並轉小寫。
- normalized phone 若已屬於另一位學員，後端阻擋並顯示「此手機已被其他學員使用」，不得覆蓋或合併。
- `claimedUserId`、`claimedAt` 不出現在可編輯欄位。
- 更新與 audit log 必須在同一 transaction。

### T3. 維護上課紀錄

- 可新增 courseName、attendedAt、source、note。
- courseName 必填；日期可空；source 限定 `MANUAL`、`IMPORT`、`1SHOP` 或既有合法來源，管理員手動新增預設 `MANUAL`。
- 可編輯既有 courseName、attendedAt、note；source 顯示但一般編輯不變更。
- 刪除單筆前顯示課程與日期並要求確認。
- 所有操作與 audit log 放在 transaction。

### T4. 永久刪除整位學員

- 刪除區塊使用紅色危險樣式，與一般編輯按鈕分開。
- 刪除前顯示：姓名、手機、Email、history 筆數、是否已認領會員。
- 使用者需輸入姓名；姓名空白時輸入手機；兩者皆空白時輸入 `DELETE`。
- Server Action 必須重新查詢資料並核對確認文字，不能只依前端確認結果。
- 在單一 transaction 先寫入完整 before snapshot，再刪除 `StudentRecord`。
- 刪除後導回 `/admin/students?deleted=1`。
- 成功訊息清楚說明：「只刪除學員記錄卡與 N 筆上課紀錄；會員帳號、訂單及觀看權限未刪除」。

### T5. 稽核紀錄

- 詳細頁顯示最近 20 筆與該 studentId 有關的操作。
- 顯示操作類型、操作者、時間與欄位變更摘要。
- 刪除後稽核資料仍可從資料庫追溯；本期不另建全站稽核搜尋頁。

### T6. 安全與一致性

- 所有 Action 先 `requireEditor()`。
- 不接受 client 傳入 history 數或認領狀態作為刪除依據。
- history 更新／刪除時 where 條件同時確認 `id` 與 `studentId`，避免跨學員 IDOR。
- 永久刪除後不得主動修改任何其他模組資料。
- 永久刪除只開放 Full Admin。若 `claimedUserId` 或同 Email 候選會員存在任何 `Enrollment`，伺服器必須即時拒絕刪除並建議改用封存；前端隱藏或停用按鈕不能取代此檢查。
- 已註冊但沒有 `Enrollment` 時，可刪除 `StudentRecord` 名單卡，但必須保留 Supabase Auth/profile、MemberProfile、訂單、場次報名、PendingEnrollment 與其他模組資料。
- 刪除前需顯示將一併 cascade 的正式課程歷史與活動接觸筆數，要求刪除原因，並輸入姓名；無姓名時改輸入 Email，再無 Email 才輸入 `DELETE`。
- 成功刪除前先建立 `StudentDataAuditLog/STUDENT_PERMANENT_DELETE`，保存必要快照、關聯筆數與刪除原因，不保存密碼或 Auth 憑證。
- 現有匯入與同步流程的測試必須回歸通過。

### T7. 文件與測試

- 更新 `CLAUDE.md` 學員資料庫段落。
- 新增學員 CRUD DB 測試，使用帶有固定 TEST 前綴的資料並在 finally 清理。
- 測試環境需有 localhost／測試 DB 安全鎖。

### T8. 名單狀態與跨模組摘要

- 詳細頁分區顯示「正式上課履歷」與「其他接觸紀錄」，不得把讀冊會或問卷算成上過正式課程。
- 可維護舊官網狀態與不含密碼的備註；`MIGRATED` 只代表人工確認已轉移，不自動建立 Enrollment。
- 提供可重用的唯讀查詢／DTO：studentId、姓名、手機、Email、claimedUserId、正式上課數、engagement 種類、legacyAccessStatus。
- UI 衍生狀態：有正式 history＝歷史學員；只有 engagement 且無正式 history＝潛在名單。不得寫入永久互斥的 `memberType`。
- 跨模組拼裝找不到唯一人物時回傳 `AMBIGUOUS`，不得依共用 Email 自動合併。

### T9. 學員名單封存

- 只有 Full Admin 可在學員詳細頁填原因後封存或解除封存；Editor 不顯示按鈕，Server Action 仍須獨立守門。
- 封存寫入 `archivedAt`、`archivedBy`、`archiveReason` 並建立 `STUDENT_ARCHIVE` audit；解除封存清空三欄並建立 `STUDENT_RESTORE` audit。
- `/admin/students` 預設只顯示 `archivedAt=null`；提供「已封存」入口與搜尋，封存頁可進詳情解除。
- 封存不得刪除或修改 Auth、MemberProfile、Enrollment、PendingEnrollment、訂單、上課履歷或接觸紀錄。

## 8. 驗收標準

| 編號 | 驗收條件 |
|---|---|
| AC-01 | Editor 可從列表進入單一學員詳細頁並看見完整 histories |
| AC-02 | 合法姓名、手機、Email 更新成功，重新整理後資料一致 |
| AC-03 | 手機正規化後與其他學員重複時，client／server 均不覆蓋、不合併且顯示可讀錯誤 |
| AC-04 | 共用 Email 的不同姓名仍可各自存在，不新增 Email unique constraint |
| AC-05 | claimedUserId／claimedAt 無法從維護 UI 或竄改表單修改 |
| AC-06 | 可新增、編輯及刪除一筆上課紀錄，其他 histories 不受影響 |
| AC-07 | historyId 屬於其他 studentId 時更新／刪除被阻擋 |
| AC-08 | 刪除整位學員前顯示 history 數與會員認領警告，確認文字錯誤時不刪除 |
| AC-09 | 正確確認永久刪除後，StudentRecord 與其 histories 消失，audit snapshot 仍存在 |
| AC-10 | 永久刪除不影響 Supabase Auth、MemberProfile、訂單、Enrollment、場次與 EDM 資料 |
| AC-11 | Viewer／未登入者呼叫任何寫入 Action 均被拒絕 |
| AC-12 | 所有新增、修改及刪除皆寫入 actor、before／after 與時間 |
| AC-13 | 現有匯入、訂單同步、認領、課名歸戶及分眾功能回歸通過 |
| AC-14 | migration 只作用於 `course` schema，不含 public/auth 或破壞既有資料的 SQL |
| AC-15 | DB 測試、typecheck、lint、Server Action 檢查及 production build 全部通過 |
| AC-16 | 正式課程履歷與讀冊會／問卷接觸紀錄分開儲存、分開統計 |
| AC-17 | 可標示舊官網 ACTIVE／待轉移／已轉移，且不保存舊站密碼、不自動授權新站影片 |
| AC-18 | 只有 engagement、沒有正式 history 的人可被篩為潛在名單 |
| AC-19 | 跨模組摘要遇共用 Email 或身分歧義時不自動合併，回傳待人工確認狀態 |
| AC-20 | Full Admin 封存後一般名單不再顯示，但可在已封存檢視找到並解除；所有歷史、帳號與權限維持不變 |
| AC-21 | Editor／coach／未登入者無法呼叫封存或解除 Action，兩種操作都有原因、操作者與時間稽核 |

## 9. 非功能需求、待確認與 Agent 指示

### 9.1 非功能需求

- 詳細頁查詢使用必要 include/select，避免 N+1。
- 列表仍限制 100 筆；本期不改分頁策略。
- 操作成功／失敗必須有頁面可見回饋，不只寫 console。
- 手機與 Email 在 audit 中屬個資；只在 Editor／Admin 後台顯示，不寫入一般應用 log。
- 破壞性操作按鈕不得與「儲存」相鄰，降低誤觸。

### 9.2 待使用者確認

1. 是否接受 Editor 與 Admin 都能永久刪除？建議沿用目前學員模組 Editor 權限；若希望更嚴格，可改為只有 Admin。
2. 是否採用本 SPEC 的「永久刪除＋稽核快照」，或改成「封存為主、永久刪除僅 Admin」？建議後者更安全，但需要新增 archivedAt 與列表篩選。
3. 上課紀錄是否允許手動新增？本 SPEC 預設允許，因維護需求通常包含漏資料補登。
4. 舊官網是否有可匯出的帳號／影片權限清單？未取得前只做人工作業狀態，不宣稱完成自動同步。

### 9.3 給 Coding Agent 的執行指示

1. 先閱讀本文件、`CLAUDE.md` 學員資料庫段落、Prisma models、`src/actions/student-history.ts` 與 `src/lib/student-history.ts`。
2. 不得修改「姓名不同＝不同人」與手機優先的既有身分判定規則。
3. 先做 migration，再實作 Action；所有破壞性寫入與 audit 必須同一 transaction。
4. 不得用 `git add -A`；工作區可能有其他 session 的未提交修改。
5. 不得為了測試刪除現有正式學員資料；測試只能建立並清理自己的 TEST 資料。
6. 完成後逐條回報 AC-01～AC-15 的證據與尚未人工驗收項目。
