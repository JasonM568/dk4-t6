# SPEC-18｜會員等級

## 0. 文件資訊
版本 v0.1 Draft；日期 2026-08-29；核心為 MemberStats、MembershipTier、付款後重算與結帳折扣。

## 1. 概述
本模組依累積成功消費與購課數計算最高符合等級，並在結帳時套用折扣。現況 `TIER_SYSTEM_ENABLED=false`：前台折扣停用但付款統計與後台資料持續更新，未來開啟時不遺失歷史。

## 2. 範圍與明確不做
- 範圍：等級門檻、折扣百分比、MemberStats 累計、付款後重算、結帳快照、前後台顯示開關。
- 不做：不處理點數、優惠券、退款倒扣、手動贈送等級或期限制會籍；未另立規則前不得實作。

## 3. 技術環境與約束
- 金額整數；discountPercent 0–100；level 唯一。
- 同時符合 minTotalSpent 與 minCoursesBought，取 level 最高。
- `computeDiscount=floor(subtotal*percent/100)`，Server 唯一計算。
- 付款成功同一 transaction 累計與 recalc；重複 callback 不重複累計。
- 開關 false 時結帳原價，但統計照常。

## 4. 相依與執行順序
Tier 設定 → Stats → 純計算 → Commerce callback → checkout 折扣 → 顯示開關 → 測試。

## 5. 資料模型
`MembershipTier`：name/level/雙門檻/discountPercent；`MemberStats`：userId、totalSpent、coursesBought、currentTierId；Order 保存 subtotal/discount/total/tierAtOrder 快照。

## 6. 角色與權限
會員只能看自己的等級（啟用時）；coach 可唯讀；Tier 規則修改建議 Full Admin。任何 client 都不能提交可信 tier 或 discount。

## 7. 任務清單
- T1 Tier CRUD 驗證與排序；防止重複 level、負門檻及非法折扣。
- T2 付款成功 upsert Stats、冪等累計、同交易重算。
- T3 checkout 讀目前等級並保存下單快照；後續改門檻不改歷史訂單。
- T4 開關一致控制前台顯示與折扣，不停止資料累積。
- T5 全量重算工具需預覽、批次與 audit，若未需求不建立。
- T6 邊界與付款回歸測試。

## 8. 驗收標準
| 編號 | 條件 |
|---|---|
| AC-01 | 會員只取得同時符合兩門檻的最高 level |
| AC-02 | 折扣由 Server 計算且無條件捨去，client 竄改無效 |
| AC-03 | 重複付款 callback 不重複 totalSpent/coursesBought |
| AC-04 | 下單保存 tier/discount 快照，之後改規則不改歷史 |
| AC-05 | 開關 false 時前台不顯示、不折扣，但付款統計仍累積 |
| AC-06 | 非 Admin 不能改門檻，非法數字不保存 |
| AC-07 | 無 Stats 會員安全視為 0／無折扣，不報錯 |
| AC-08 | tier/checkout/payment tests、typecheck、lint、build 通過 |

## 9. 非功能需求與 Agent 指示
規則變更需說明是否即時重算舊會員；目前為下次付款時重算。退款如何倒扣尚未定義，未確認前不得自行減少 Stats。
