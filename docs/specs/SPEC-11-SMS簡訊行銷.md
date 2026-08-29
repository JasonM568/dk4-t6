# SPEC-11｜SMS 簡訊行銷

## 0. 文件資訊

| 欄位 | 內容 |
|---|---|
| 版本／日期 | v0.1 Draft／2026-08-29 |
| 路由 | `/admin/sms`、`/admin/sms/[id]`、`/admin/sms/optouts` |
| 技術基線 | `docs/sms-module.md`、MAAC Go adapter |

## 1. 概述

本模組發送履約通知與未來的合規行銷簡訊，管理名單、則數、成本、排程、逐人結果、送達狀態與拒收。它是直接產生成本的模組，所有限制必須在最終 execute 層重驗，不能只靠表單預覽。

## 2. 範圍與明確不做

- 範圍：SESSION/MANUAL 名單、NOTICE/MARKETING 分流、測試／立即／排程、字數則數、成本上限、dry-run/MAAC Go、逐筆結果、退訂與失敗補發。
- 不做：目前不開放 ALL；GROUP 要等 MailGroup 手機資料另案；免費行銷退訂短連結未完成前 UI 只開 NOTICE；不自動重寄。

## 3. 技術環境與約束

- 手機統一 `normalizeMobile()`；發送與預覽共用 `composeSmsText()`、`resolveMobiles()`。
- 中文 UCS-2 70／67、GSM-7 160／153；emoji 阻擋，GSM 擴充字元計 2。
- 成本存分；設定從 SiteSetting 讀取且 clamp/fallback。
- 未設定 provider 預設 dry-run；live/test 金鑰狀態需醒目顯示。
- 單次與每日限制在 `executeSmsBroadcast()` 重驗；超標整批不送。

## 4. 相依與執行順序

手機／內容純函式 → 名單解析與退訂漏斗 → provider → execute 成本守門 → 排程 → 逐筆狀態／webhook → UI／測試。SESSION 依賴 SPEC-08。

## 5. 資料模型

- `SmsBroadcast`：內容、類型、對象、成本快照、排程、結果及操作者。
- `SmsMessage`：每收件人 provider id、狀態、則數、成本與錯誤。
- `SmsOptOut`：USER/MANUAL 只擋行銷；INVALID/PROVIDER 擋所有。
- 場次通知成功回寫 `SessionSignup.smsNoticeAt`。

## 6. 角色與權限

coach 只能查看允許資料；Editor 可預覽、發送、排程與維護退訂；敏感費率／上限設定依現況至少 Editor，建議收緊 Full Admin。所有 Action／webhook／cron 各自驗證。

## 7. 任務清單

- T1 內容：品牌前綴、變數、則數、emoji、行銷退訂 footer。
- T2 名單：送出當下解析、去重、海外／無手機、延期排除、ALL/PENDING。
- T3 退訂：依 messageType/source 單一漏斗過濾。
- T4 成本：逐人渲染後計實際則數；單次、每日、預估金額與二次確認。
- T5 provider：逐筆對應、429/5xx/網路重試、缺憑證回可讀失敗、不讓頁面 500。
- T6 排程：台北時間、至少未來 60 秒、cron 認領、逾時 FAILED、不自動重寄。
- T7 送達：查詢或 webhook 驗簽後更新 SmsMessage，冪等彙總 broadcast。
- T8 測試與文件：pure、DB、provider mock、EDM／場次回歸。

## 8. 驗收標準

| 編號 | 條件 |
|---|---|
| AC-01 | 預覽與實際使用同一內容／名單路徑，去重人數一致 |
| AC-02 | NOTICE 不受 USER/MANUAL 行銷退訂影響，但 INVALID 仍排除 |
| AC-03 | MARKETING 未具免費退訂機制時不能正式開放 |
| AC-04 | 中文、GSM-7、擴充字元與姓名替換後則數正確 |
| AC-05 | dry-run 不送出且 UI 明確標示；live 缺憑證逐筆失敗不 500 |
| AC-06 | execute 層超過單次／每日限制整批不送 |
| AC-07 | 排程送出當下重算名單與成本，逾時不自動重寄 |
| AC-08 | provider 結果逐人保存，只有成功者回寫 smsNoticeAt |
| AC-09 | webhook／狀態刷新冪等，不重複計 deliveredCount |
| AC-10 | 無權限者不能發送、匯出或改退訂／設定 |
| AC-11 | SMS pure/DB/MAAC mock、session notice、typecheck、lint、build 通過 |

## 9. 非功能需求與 Agent 指示

- 不在 log 顯示完整手機名單或 API key。
- 不得自動把履約用途 SessionSignup 手機轉成行銷名單。
- 新 provider 必須遵守逐筆結果、timeout、重試與中文錯誤契約。
- 待確認：費率設定權限、MARKETING 上線日期、GROUP 手機 schema；未確認不擴大發送範圍。
