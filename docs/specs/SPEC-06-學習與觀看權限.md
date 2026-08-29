# SPEC-06｜學習與觀看權限

## 0. 文件資訊

| 欄位 | 內容 |
|---|---|
| 版本／日期 | v0.1 Draft／2026-08-29 |
| 模組 | Learning Access |
| 核心資料 | Enrollment、PendingEnrollment |
| 狀態 | 現況基線 SPEC，待產品驗收 |

## 1. 概述

本模組回答「某位使用者能不能看到／觀看某門課」。一般課程以 `Enrollment` 為核心；專區課程另依專區類型、會員名單與限時開放規則判斷。所有購買、手動開通、批次匯入與待開通認領最後都必須收斂到一致的觀看守門。

## 2. 範圍與明確不做

### 2.1 範圍
- 我的課程與播放頁權限。
- 單筆、批次開通與撤銷 Enrollment。
- 未註冊 Email 的 PendingEnrollment 存底與註冊後認領。
- 專區會員的可見性與限時／訂閱觀看例外。
- 後台幹部預覽。

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

## 9. 非功能需求與 Agent 指示

- 權限查詢需有索引且避免 N+1。
- 不得把「訂單 PAID」或「專區可見」單獨等同一般 Enrollment。
- 修改守門前必讀 Zones、Subscription 與 Commerce SPEC。
- 待確認：訂閱資格未來是否以 Subscription 狀態取代 CourseGroupMember；未決前維持現行名單規則。
