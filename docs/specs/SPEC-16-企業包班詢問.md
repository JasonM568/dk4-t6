# SPEC-16｜企業包班詢問

## 0. 文件資訊
版本 v0.1 Draft；日期 2026-08-29；路由 `/corporate`、`/admin/corporate`。

## 1. 概述
本模組收集企業包班需求、通知內部人員、回覆聯絡人並提供後台 CRM 式狀態與備註。收單成功是核心；通知或自動回信失敗不得造成需求消失。

## 2. 範圍與明確不做
- 範圍：公開表單、驗證／蜜罐／防重、Inquiry 入庫、內部通知、自動回覆、狀態、內部備註、通知 Email 設定、刪除。
- 不做：不自動建立訂單、場次、會員或 EDM 行銷同意；不當完整 CRM／報價／合約系統。

## 3. 技術環境與約束
- Email lowercase；phone 白名單格式；長度裁切；選項值 Server 白名單。
- 同 Email 10 分鐘防重；蜜罐觸發裝成功、不入庫。
- 狀態固定 NEW/CONTACTED/WON/CLOSED。
- 寄信 failure 被捕捉並去敏記錄，不 rollback 已成功收單。
- 通知收件人 SiteSetting 僅接受有效 Email；建議 Full Admin 管理。

## 4. 相依與執行順序
公開表單 → 驗證／防濫用 → 入庫 → 非關鍵通知 → 後台狀態 → retention/audit → 測試。

## 5. 資料模型
`CorporateInquiry` 保存公司、聯絡人、聯絡方式、需求、狀態與 adminNote；`SiteSetting.corporateNotifyEmail` 保存通知目的地。

## 6. 角色與權限
訪客只可新增；coach 可依現況查看但不得改；Editor 更新狀態／備註；刪除與通知設定建議 Admin。內部備註絕不公開或放入自動回覆。

## 7. 任務清單
- T1 表單可用性、隱私告知、欄位白名單與蜜罐。
- T2 10 分鐘防重與一致成功文案，避免 Email existence oracle。
- T3 先入庫，再通知管理員與聯絡人；失敗可觀測不影響收單。
- T4 後台篩選、狀態、備註與安全刪除。
- T5 通知設定驗證、權限與測試。

## 8. 驗收標準
| 編號 | 條件 |
|---|---|
| AC-01 | 合法需求先成功入庫，寄信失敗仍保留 |
| AC-02 | 非法／竄改選項不入庫，欄位長度受限 |
| AC-03 | 同 Email 10 分鐘重送不新增或重複通知 |
| AC-04 | 蜜罐不入庫、不寄信且對外回一般成功 |
| AC-05 | adminNote 不出現在公開回應或自動回覆 |
| AC-06 | 狀態只能在白名單內，Server 阻擋越權 |
| AC-07 | 通知設定無效 Email 不保存，非 Admin 依定稿矩陣被拒絕 |
| AC-08 | 刪除有確認／audit，或依 retention 政策封存 |
| AC-09 | corporate/email tests、typecheck、lint、build 通過 |

## 9. 非功能需求與 Agent 指示
聯絡資料屬個資，不進一般 analytics/log；需決定保留期限與刪除政策。未取得行銷同意前不得自動加入 EDM 群組。待確認 coach 查看、設定與刪除的最終權限。
