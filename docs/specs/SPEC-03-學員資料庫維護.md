# SPEC-03｜學員資料庫維護（編輯、課程紀錄維護與刪除）

## 0. 文件資訊

| 欄位 | 內容 |
|---|---|
| 文件版本 | v0.1 Draft |
| 建立日期 | 2026-08-29 |
| 模組 | 學員資料庫 `/admin/students` |
| 需求來源 | 現行程式、資料模型、CLAUDE.md、使用者需求「可以刪除跟編輯名單」 |
| 實作對象 | Claude／Coding Agent |
| 狀態 | 待使用者確認後實作 |

### 已確認需求

1. 後台管理者需要編輯學員資料。
2. 後台管理者需要刪除錯誤的學員資料。
3. 既有匯入、訂單同步、搜尋、課名歸戶與分眾功能必須保持可用。

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

### 2.2 明確不做

- 不刪除或編輯 Supabase `auth.users`／`public.profiles`。
- 不刪除 `Enrollment`、`PendingEnrollment`、訂單、付款、場次報名或 EDM 歷史。
- 不把兩位學員合併成一位；合併需另立 SPEC。
- 不批次刪除學員。
- 不以 Email 改為唯一識別鍵。
- 不允許使用者自行修改學員歷史。
- 不提供稽核快照的一鍵還原。

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

### 5.2 新增 `StudentDataAuditLog`

| 欄位 | 型別 | 說明 |
|---|---|---|
| `id` | String cuid | 主鍵 |
| `studentId` | String nullable | 軟連結；學生刪除後仍保留原 id |
| `historyId` | String nullable | 單筆課程操作時保存原 id |
| `action` | String | `STUDENT_UPDATE`、`STUDENT_DELETE`、`HISTORY_CREATE`、`HISTORY_UPDATE`、`HISTORY_DELETE` |
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
- 現有匯入與同步流程的測試必須回歸通過。

### T7. 文件與測試

- 更新 `CLAUDE.md` 學員資料庫段落。
- 新增學員 CRUD DB 測試，使用帶有固定 TEST 前綴的資料並在 finally 清理。
- 測試環境需有 localhost／測試 DB 安全鎖。

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

### 9.3 給 Coding Agent 的執行指示

1. 先閱讀本文件、`CLAUDE.md` 學員資料庫段落、Prisma models、`src/actions/student-history.ts` 與 `src/lib/student-history.ts`。
2. 不得修改「姓名不同＝不同人」與手機優先的既有身分判定規則。
3. 先做 migration，再實作 Action；所有破壞性寫入與 audit 必須同一 transaction。
4. 不得用 `git add -A`；工作區可能有其他 session 的未提交修改。
5. 不得為了測試刪除現有正式學員資料；測試只能建立並清理自己的 TEST 資料。
6. 完成後逐條回報 AC-01～AC-15 的證據與尚未人工驗收項目。
