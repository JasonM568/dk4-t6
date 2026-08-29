# SPEC-09｜場次收支與分潤

## 0. 文件資訊

| 欄位 | 內容 |
|---|---|
| 版本／日期 | v0.1 Draft／2026-08-29 |
| 路由 | `/admin/finance`、`/admin/finance/[id]`、settings、finance-sheet |
| 權限 | Full Admin only |
| 狀態 | 高敏感現況基線 SPEC |

## 1. 概述

本模組把 1shop 與人工收入轉為每場收入、成本、外部分潤、毛利及內部分潤。財務資料與報名名單刻意分離：SessionSignup 表示人，SessionOrder/Line 表示錢。分潤屬內部薪酬，只有 Admin 可查看與操作。

## 2. 範圍與明確不做

- 範圍：訂單／明細匯入、認列、退款、人工收入、成本、費率、外部／內部分潤、方案歸戶、模板、鎖定快照、Google Sheet 匯出。
- 不做：不作會計總帳、發票、銀行付款、薪資匯款；不讓 operator/coach 查看；不從 SessionSignup.amount 算收入。

## 3. 技術環境與約束

- 金額 `Int` 新台幣元；費率 ppm，所有四捨五入只走共用 compute。
- `(sessionId,orderNo)` 唯一；line 是收入最小單位。
- `manualOverride=true` 後重匯不得蓋人工金額、認列與方案名。
- DRAFT 即時計算；LOCKED 保存快照，費率或重匯不得改歷史結算。
- 匯出 Route 需 Full Admin Server 驗證。

## 4. 相依與執行順序

場次存在 → 匯入訂單／明細 → 方案歸戶 → 認列／成本 → compute → 分潤 → 鎖定快照 → 匯出。相依 Sessions，但資料 owner 分離。

## 5. 資料模型

- `SessionOrder/Line`：付款與逐產品認列真值。
- `SessionCost`：RATE、FIXED、EXTERNAL_SHARE；自動列可重算，人工列不可覆蓋。
- `SessionProfitShare`：毛利後內部分配，payee 唯一。
- `SessionFinance`：DRAFT/LOCKED 與總額快照。
- `FinancePlanAlias`、`SiteSetting`：產品顯示名、費率及預設分潤。

## 6. 角色與權限

所有頁面、Actions、匯入與匯出只限 Full Admin；operator/coach 不只不能修改，也不能看到金額或分潤分頁。

## 7. 任務清單

- T1 匯入：原始欄位保留、重傳冪等、退款保留金額追溯、組合方案人工認列。
- T2 收入維護：人工收入、付款方式、學生類型、recognizedAmount、manualOverride。
- T3 成本：費率型自動重算、固定成本、外部分潤，人工列不被重算刪除。
- T4 compute：收入－支出＝毛利，再依 share ppm 分配；警告比例與尾差。
- T5 設定與模板：變更只影響 DRAFT；LOCKED 不漂移。
- T6 鎖定／解鎖策略：鎖定記 actor/time/snapshot；本期若允許解鎖需明確 audit。
- T7 Google Sheet：欄位、例外說明、來源檔、金額格式與 Server 權限。
- T8 測試：純計算邊界、DB 重匯、人工覆寫、鎖定與授權。

## 8. 驗收標準

| 編號 | 條件 |
|---|---|
| AC-01 | 同檔重匯不重複訂單／明細，且原始追溯欄可更新 |
| AC-02 | SessionSignup.amount 永不參與財務加總 |
| AC-03 | 組合方案可按場次指定 recognizedAmount，重匯不覆蓋 |
| AC-04 | 退款列保留追溯但不計有效收入 |
| AC-05 | 自動成本可重算，人工成本與 override 不被改寫 |
| AC-06 | ppm 計算與四捨五入符合共用 compute，分潤異常有警告 |
| AC-07 | LOCKED 後費率、重匯與模板調整不改快照 |
| AC-08 | operator/coach 對頁面、Action、Sheet 均無權限 |
| AC-09 | Sheet 可由 Google Sheets 正常開啟且總額與頁面一致 |
| AC-10 | session-finance pure/DB tests、typecheck、lint、build 通過 |

## 9. 非功能需求與 Agent 指示

- 財務操作需 audit；log 不輸出完整訂單個資。
- compute 保持純函式，UI 不另寫公式。
- 任何 schema 改動需保留 LOCKED 歷史可讀性。
- 待確認：誰可解鎖及解鎖是否需雙人確認；未確認前不得新增便捷解鎖。
