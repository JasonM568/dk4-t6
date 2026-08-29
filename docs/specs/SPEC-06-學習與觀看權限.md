# SPEC-06｜學習與觀看權限

## 0. 文件資訊

| 欄位 | 內容 |
|---|---|
| 版本／日期 | v0.2 Draft／2026-08-29 |
| 模組 | Learning Access |
| 核心資料 | Enrollment、PendingEnrollment |
| 狀態 | 現況基線 SPEC，待產品驗收 |

## 1. 概述

本模組回答「某位使用者能不能看到／觀看某門課」。一般課程以 `Enrollment` 為核心；專區課程另依專區類型、會員名單與限時開放規則判斷。所有購買、手動開通、批次匯入與待開通認領最後都必須收斂到一致的觀看守門。

本輪優化另要求本模組回答「這門課的開通作業是否完成」：同一頁可區分已正式開通、尚未註冊而待開通、以及已有報名／上課事實但疑似漏開通的人。

## 2. 範圍與明確不做

### 2.1 範圍
- 我的課程與播放頁權限。
- 單筆、批次開通與撤銷 Enrollment。
- 未註冊 Email 的 PendingEnrollment 存底與註冊後認領。
- 專區會員的可見性與限時／訂閱觀看例外。
- 後台幹部預覽。
- 每堂課的統一觀看名單查核頁與批次開通結果報告。

### 2.2 不做
- 不處理付款驗章、課程內容 CRUD 或專區會員 CRUD。
- 不以訂單頁顯示狀態直接當觀看權限。
- 不把 Email 當 Enrollment 主鍵。
- 不自行刪除會員或訂單。

## 3. 技術環境與約束

- `Enrollment(userId, courseId)` 唯一，所有寫入需 upsert/createMany skipDuplicates。
- userId 是 Supabase UUID、無 FK。
- `source` 值至少包含 PURCHASE、MANUAL、BATCH、IMPORT；歷史 null 需相容。
- `PendingEnrollment(courseId,email)` 唯一，Email 正規化。
- 公開型錄查詢統一使用 `publicCourseWhere()`；不得讓專區課程透過 courseId 繞過購買限制。
- `canWatchCourse()`／`canViewGroupCourse()` 是現行核心守門，新增入口不得自行複製簡化規則。

## 4. 相依與執行順序

1. Identity 提供可信 user。
2. Course Catalog 提供課程發布與 group 屬性。
3. Enrollment／PendingEnrollment services。
4. 購買、管理員與專區等來源呼叫統一介面。
5. 我的課程與播放頁守門。

## 5. 資料模型

`Enrollment`
- 唯一 `(userId, courseId)`。
- `orderId` 保存購買來源；`source` 保存授權來源。

`PendingEnrollment`
- 未註冊者先以 normalized Email 存底。
- `claimedAt/userId` 有值代表已認領，保留稽核、不重複觸發。

### 5.1 衍生開通狀態（不新增互斥主檔欄位）

| 狀態 | 判定 |
|---|---|
| `ENROLLED` | 已有 `(userId, courseId)` Enrollment |
| `PENDING_REGISTRATION` | 無可用 userId，已有未認領 PendingEnrollment |
| `POSSIBLE_MISSING` | 場次／歷史資料顯示此人上過或有效報名對應課程，但 Enrollment 與 pending 皆不存在 |
| `UNRESOLVED_IDENTITY` | 有上課／報名事實，但無法唯一對到 Auth 或 StudentRecord |

`POSSIBLE_MISSING` 是營運警示，不得自動等同授權；需由 operator/admin 確認後建立 Enrollment 或 PendingEnrollment。

`Course.groupId/openToGroupUntil`、`CourseGroup.kind`、`CourseGroupMember` 提供專區例外；資料 owner 仍屬 Course Catalog／Zones／Subscription。

## 6. 角色與權限

| 操作 | 會員 | coach | operator | admin |
|---|---:|---:|---:|---:|
| 查看自己的課程 | 是 | 是 | 是 | 是 |
| 預覽專區課程 | 需資格 | 是 | 是 | 是 |
| 手動／批次開通與撤銷 | 否 | 否 | 是 | 是 |
| 查看待開通名單 | 否 | 依頁面唯讀 | 是 | 是 |

## 7. 任務清單

### T1. 觀看守門
- 未登入一律不能觀看會員課程。
- 一般課程需 Enrollment。
- SUBSCRIPTION 專區會員在名單內可看該專區全部課程。
- 企業專區限時開放期間，名單會員即使 Enrollment 補寫失敗仍可觀看；期限後回到 Enrollment。

### T2. 手動與批次授權
- 已存在 Enrollment 視為成功冪等，不重複。
- 撤銷只刪指定 user/course；不得刪訂單。
- 批次名單內未註冊者建立 PendingEnrollment。

### T3. 待開通認領
- 註冊或管理員建帳後認領該 Email 全部未認領項目。
- Enrollment 建立與 pending 回填需具可恢復性；重跑不得重複授權。

### T4. 顯示與來源
- 後台清楚顯示 PURCHASE/MANUAL/BATCH/IMPORT 與待認領狀態。
- 使用者只看可觀看結果，不顯示內部 UUID 或稽核資訊。

### T4A. 課程觀看名單查核頁

- 每堂課提供 `全部／已開通／待註冊／可能漏開通／身分待確認` 篩選。
- 頂端顯示總數：來源名單人數、已開通、待註冊、可能漏開通、身分待確認；數字必須有明確集合定義，避免同一人重複計數。
- 每列至少顯示姓名、手機／Email、帳號狀態、報名／上課狀態、影片權限、開通來源與日期。
- 主操作「加入上課學員並處理影片權限」接受人工貼上或經 SPEC-08 提供的有效場次名單：已註冊者 upsert Enrollment；未註冊且有有效 Email 者 upsert PendingEnrollment；資料不足或歧義者列入 unresolved，不猜測。
- 完成報告固定回傳：直接開通數、待註冊數、已存在略過數、資料不足數、身分衝突數與逐筆錯誤下載／顯示入口。
- 從某堂課撤銷觀看權限，只處理 Enrollment；不得刪除其報名、上課履歷、pending 歷史、訂單或人物主檔。

### T5. 測試
- 涵蓋購買、手動、批次、待認領、撤銷、專區限時、訂閱專區與越權。

## 8. 驗收標準

| 編號 | 條件 |
|---|---|
| AC-01 | 無 Enrollment 的一般會員不能直接開啟播放頁 |
| AC-02 | PURCHASE/MANUAL/BATCH/IMPORT 建立後均可觀看且不重複 |
| AC-03 | 同一 user/course 併發或重跑仍只有一筆 Enrollment |
| AC-04 | 未註冊 Email 建立 pending，註冊後自動認領且冪等 |
| AC-05 | 撤銷只移除指定觀看權限，不刪除訂單與付款歷史 |
| AC-06 | 專區課程不出現在公開型錄且不能用 courseId 直接購買 |
| AC-07 | SUBSCRIPTION 會員在名單內可看、移出後立即失去例外資格 |
| AC-08 | 企業專區限時規則在到期前後正確切換 |
| AC-09 | 後台幹部可預覽但不因此新增 Enrollment |
| AC-10 | 未授權者不能批次開通或撤銷 |
| AC-11 | purchase/claim/access DB tests、typecheck、lint、build 通過 |
| AC-12 | 課程頁可在同一畫面查看已開通、待註冊、可能漏開通與身分待確認名單 |
| AC-13 | 匯入混合名單後，已註冊者直接開通、未註冊者建立 pending、歧義者不被錯誤開通 |
| AC-14 | 操作完成報告的各分類互斥且總和可與輸入有效列核對 |
| AC-15 | 有上課事實但無權限者只顯示警示，不在未經操作員確認下自動取得影片權限 |

## 9. 非功能需求與 Agent 指示

- 權限查詢需有索引且避免 N+1。
- 不得把「訂單 PAID」或「專區可見」單獨等同一般 Enrollment。
- 修改守門前必讀 Zones、Subscription 與 Commerce SPEC。
- 待確認：訂閱資格未來是否以 Subscription 狀態取代 CourseGroupMember；未決前維持現行名單規則。
