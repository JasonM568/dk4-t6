# SPEC-07｜訂單與金流

## 0. 文件資訊

| 欄位 | 內容 |
|---|---|
| 版本／日期 | v0.1 Draft／2026-08-29 |
| 模組 | Commerce／ECPay |
| 路由 | 結帳、`/orders`、payment notify／return |
| 狀態 | 高風險現況基線 SPEC，待產品驗收 |

## 1. 概述

本模組負責從下單到付款入帳的交易生命週期。金額與折扣只由 Server 計算；ECPay server-to-server notify 驗章結果是付款唯一真實來源。瀏覽器 return 只能導頁，禁止發貨、標記付款或建立 Enrollment。

## 2. 範圍與明確不做

### 2.1 範圍
- 公開課程結帳、會員折扣快照。
- Order、OrderItem、Payment 建立與查詢。
- ECPay 表單、notify 驗章、return 導頁。
- 訂單狀態機、防重、付款後 Enrollment 與會員統計。
- 會員本人與後台訂單查詢。

### 2.2 不做
- 不販售企業／訂閱專區課程。
- 不接受 client 傳入價格、折扣或付款成功狀態。
- 不在瀏覽器 return 發貨。
- 本期不做退款、部分退款、發票、購物車、多商品訂單或人工改 PAID。
- 不接觸或保存信用卡卡號、CVV。

## 3. 技術環境與約束

- 金額以整數新台幣保存；不得用浮點數。
- `orderNo` ≤20 字元、加密安全亂數、不可枚舉。
- `checkoutKey=userId:courseId` nullable unique；PENDING 離開時清 null。
- 逾期 PENDING 目前 2 小時 lazy 轉 EXPIRED。
- notify 必須驗 CheckMacValue、MerchantID、金額，並具冪等交易。
- 生產環境不得 fallback 到測試 MerchantID。
- Payment provider 走 `src/lib/payment` 抽換介面。

## 4. 相依與執行順序

1. Identity、Course Catalog、Membership。
2. Server-side checkout 與訂單防重。
3. Provider adapter。
4. notify 驗章與狀態交易。
5. 呼叫 Learning Access 建 Enrollment、Membership 重算。
6. 訂單頁、後台與端到端測試。

## 5. 資料模型與狀態

`Order`：orderNo、checkoutKey、userId、buyerEmail 快照、subtotal/discount/total、tierAtOrder、status、paidAt。

`OrderItem`：課程與下單當下單價快照；同訂單同課程唯一。

`Payment`：provider、status、amount、tradeNo、paymentType、rawCallback、notifiedAt；不保存卡號。

`Enrollment`：付款成功後以 source PURCHASE 建立。

訂單狀態：`PENDING → PAID | FAILED | EXPIRED`。PAID 是終態；重複 callback 不得再次累加會員統計或建立授權。

## 6. 角色與權限

| 操作 | 未登入 | 會員本人 | staff | editor/admin |
|---|---:|---:|---:|---:|
| 建立結帳 | 否 | 是 | 以會員身分 | 以會員身分 |
| 查看自己的訂單 | 否 | 是 | 是 | 是 |
| 查看全站訂單 | 否 | 否 | 依 RBAC 唯讀 | 是 |
| 接收 notify | ECPay 驗章 | 不適用 | 不適用 | 不適用 |
| 人工標 PAID | 否 | 否 | 否 | 本期不提供 |

訂單詳細頁必須驗證 owner 或 staff，不得只靠不可猜的 orderNo。

## 7. 任務清單

### T1. 結帳前驗證
- 需登入；課程存在、公開、未過停售時間且 `groupId=null`。
- 已有 Enrollment 不得重購。
- 價格與會員折扣從 DB 重新計算；total≤0 阻擋並提示人工開通。

### T2. 原子防重與訂單建立
- 在單次 Prisma nested create 建 Order/Item/Payment。
- P2002 回傳已有待付款訂單；provider 表單建立失敗則 Order→FAILED 並釋放 checkoutKey。

### T3. Provider 與 callback
- createPayment 組 notify、result、clientBack URL。
- notify 驗章失敗回拒絕字串；找不到訂單不得建立新訂單。
- 金額或 MerchantID 不符時不 PAID、不授權，寫去敏異常 log。

### T4. 付款成功交易
- 同一 transaction 更新 Order、Payment、upsert Enrollment、upsert MemberStats、recalcTier。
- 重送已 PAID callback 直接回成功，不重複副作用。
- 失敗 callback 更新 FAILED 並釋放防重鍵。

### T5. 顯示、安全與測試
- return 只 303 導到訂單頁。
- 會員訂單頁只查本人；後台依 RBAC。
- 測試簽章、錯誤金額、錯 MerchantID、重送、併發、過期、provider 失敗及授權。

## 8. 驗收標準

| 編號 | 條件 |
|---|---|
| AC-01 | 未登入、未發布、停售、專區、已擁有及 total≤0 課程均不能結帳 |
| AC-02 | client 竄改價格或折扣不影響 Server 計算結果 |
| AC-03 | 同會員同課程同時最多一筆有效 PENDING |
| AC-04 | 超過 2 小時 PENDING 轉 EXPIRED 並可重新結帳 |
| AC-05 | provider 建表單失敗後不留下阻擋重試的 checkoutKey |
| AC-06 | notify 驗章、金額或 MerchantID 任一不符均不 PAID、不授權 |
| AC-07 | return route 不能改付款狀態或建立 Enrollment |
| AC-08 | 成功 notify 原子完成 Order、Payment、Enrollment、MemberStats 與 tier |
| AC-09 | 同 callback 重送不重複授權、不重複累加消費 |
| AC-10 | 會員無法查看他人 orderNo；staff 依 RBAC 查看 |
| AC-11 | 系統不接觸或保存卡號與 CVV |
| AC-12 | ECPay unit、purchase flow、typecheck、lint、build 通過 |

## 9. 非功能需求、風險與 Agent 指示

- 付款 callback 錯誤需可觀測，但 log 不含秘密或完整個資。
- DB transaction 失敗要回 ECPay 可重送的錯誤回應。
- 修改狀態機、金額或 callback 時必跑 `test-ecpay.ts`、`test-purchase-flow.ts`。
- 正式測試需公開 HTTPS callback；localhost 無法證明 ECPay 端到端。
- 待確認：退款／取消政策、發票與人工補單；未確認前不得擴充狀態機。
