# SPEC-12｜課程目錄與內容

## 0. 文件資訊
版本 v0.1 Draft；日期 2026-08-29；範圍為課程分類、課程、章節、教材與公開型錄。

## 1. 概述
本模組擁有線上課程的內容與公開販售屬性。它決定課程如何建立、排序、發布、下架及展示，但不決定會員是否付款成功或有觀看權限。

## 2. 範圍與明確不做
- 範圍：Category、Course CRUD／複製／排序、封面與介紹圖、價格、發布／定時下架、Lesson、CourseMaterial、前台型錄與詳情。
- 不做：不處理付款、Enrollment、專區會員或檔案儲存底層；不在 client 決定實售價與可購買性。

## 3. 技術環境與約束
- slug、courseCode 唯一；金額整數元；listPrice 只展示，price 才是金流價格。
- 公開查詢一律使用 `publicCourseWhere()`／`isCoursePublicActive()`。
- `groupId != null` 的課程不進公開型錄、不可一般結帳。
- 課程刪除會級聯章節、教材、Enrollment/Pending 等重要資料，必須揭露影響；建議優先下架。
- YouTube 只存 video id；教材 URL 需 http(s) 且經上傳規則。

## 4. 相依與執行順序
分類 → 課程 → 媒體 → 章節／教材 → 發布與型錄 → 與 Commerce/Learning/Zones 整合 → 測試。

## 5. 資料模型
- Category 多對多 Course；Course 擁有展示、價格、發布、專區與下架欄位。
- Lesson 依 order 排序；CourseMaterial 保存名稱與 URL。
- Course 被 OrderItem 參照時永久刪除可能失敗或破壞歷史，Agent 不得用級聯繞過。

## 6. 角色與權限
公開者只看有效公開課；會員相同並可依其他模組購買／觀看；coach 唯讀；operator/admin 可管理內容。永久刪除建議限 admin 或在無交易／授權關聯時才允許。

## 7. 任務清單
- T1 分類 CRUD、唯一名稱與排序。
- T2 課程表單 Server 驗證 slug、價格、URL、發布與專區欄位。
- T3 排序／置頂／複製，複製後預設 unpublished 且 unique 欄位重建。
- T4 Lesson/Material 增刪改排序，跨 course id 操作阻擋。
- T5 公開型錄、詳情與 checkout 共用相同可用條件。
- T6 刪除影響檢查、下架替代與稽核。
- T7 typecheck、路由、授權與購買回歸。

## 8. 驗收標準
| 編號 | 條件 |
|---|---|
| AC-01 | 未發布、已到下架時間或專區課程不出現在公開型錄 |
| AC-02 | 直接使用 slug/courseId 也不能繞過詳情或結帳限制 |
| AC-03 | 課程複製不沿用唯一 slug/code，且預設不公開 |
| AC-04 | 章節／教材只能由其所屬 course 修改或刪除 |
| AC-05 | Server 不接受 client 竄改價格或發布狀態 |
| AC-06 | 有訂單／授權的課程不被無警告永久刪除，歷史仍可讀 |
| AC-07 | coach 無寫入，operator/admin 依 RBAC 操作 |
| AC-08 | course/access/checkout tests、typecheck、lint、build 通過 |

## 9. 非功能需求與 Agent 指示
避免首頁與型錄 N+1；圖片需 alt／尺寸策略；修改公開條件必跑 Commerce、Learning、Zones 回歸。待確認永久刪除政策，未決前建議改用下架。
