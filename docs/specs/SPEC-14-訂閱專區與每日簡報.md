# SPEC-14｜訂閱專區與每日簡報

## 0. 文件資訊
版本 v0.1 Draft；日期 2026-08-29；kind=`SUBSCRIPTION`；涵蓋訂閱影片、方案／狀態預留與每日財經剪報。

## 1. 概述
訂閱專區讓名單會員觀看整區影片並閱讀訂閱限定內容。現況資格以 CourseGroupMember 管理；Subscription/Payment schema 已預留，但付款 provider 尚未形成完整流程。SPEC 明確區分「現行名單制」與「未來付費訂閱」。

## 2. 範圍與明確不做
- 本期現況：訂閱專區 CRUD、會員名單、整區影片觀看、訂閱限定 Knowledge、每日剪報 CRUD。
- 預留：方案、訂閱狀態、付款紀錄與會籍同步。
- 不做：未有 provider SPEC 前不啟用自動扣款；不把 PENDING/FAILED 當有效資格；不承諾退款或續訂規則。

## 3. 技術環境與約束
- 現行觀看資格以 normalized Email 的 CourseGroupMember 為真值；移除立即失效。
- 每專區每天 `(groupId,dateKey)` 唯一；dateKey 用 Asia/Taipei。
- 剪報至少一張 http(s) 圖；圖片順序保存；DRAFT/PUBLISHED/UNPUBLISHED 白名單。
- Subscription ACTIVE 同步 CourseGroupMember 的流程未完成前不得半接上線。

## 4. 相依與執行順序
Subscription zone → 會員名單 → 課程觀看 → Knowledge 可見性 → DailyBrief → 未來 plan/provider/state machine。

## 5. 資料模型
`CourseGroup(kind=SUBSCRIPTION)`、`CourseGroupMember`、`SubscriptionPlan`、`Subscription`、`SubscriptionPayment`、`DailyBrief/Image`、`KnowledgeArticle.visibility`。

## 6. 角色與權限
非會員看擋牆；名單會員看專區影片、剪報與 subscriber 文章；staff 可預覽；Editor 管理名單／內容；未來金流設定與退款只限 Admin。

## 7. 任務清單
- T1 專區與名單：類型固定、有效狀態與移除即失效。
- T2 觀看：SUBSCRIPTION 名單是整區例外，不逐課建立 Enrollment。
- T3 剪報：今日建立、三款封面輪替、圖片排序、狀態與刪除。
- T4 訂閱限定文章：Server 驗證任一有效訂閱專區會員，不只隱藏 UI。
- T5 未來金流：providerRef 冪等、ACTIVE/CANCELED/EXPIRED 狀態與 group member 同步需另行驗收才啟用。
- T6 測試：名單、觀看、內容、日期唯一與越權。

## 8. 驗收標準
| 編號 | 條件 |
|---|---|
| AC-01 | 名單會員可看整區課程，移出後立即失去名單例外 |
| AC-02 | 非會員無法用直連讀 subscriber 文章或剪報 |
| AC-03 | 同專區同日期只能一篇剪報，台北日期邊界正確 |
| AC-04 | 剪報至少一圖、排序一致，非 PUBLISHED 不公開 |
| AC-05 | BUSINESS 與 SUBSCRIPTION 觀看規則不混用 |
| AC-06 | 未完成 provider 前 Subscription PENDING 不授權 |
| AC-07 | Editor/Viewer 權限在 Page 與 Action 一致 |
| AC-08 | subscription/access/content tests、typecheck、lint、build 通過 |

## 9. 非功能需求與 Agent 指示
付款上線前需另補 provider、續訂、取消、退款與 webhook 子 SPEC。圖片需控制數量／大小。不得僅因 schema 已存在就宣稱付費訂閱完成。
