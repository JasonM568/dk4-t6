# SPEC-08｜場次報名與看板

## 0. 文件資訊

| 欄位 | 內容 |
|---|---|
| 版本／日期 | v0.1 Draft／2026-08-29 |
| 範圍 | `/admin/sessions`、`/board`、`/live` |
| 核心資料 | CourseSession、SessionSignup、BoardLoginThrottle |
| 狀態 | 現況基線 SPEC |

## 1. 概述

本模組管理實體／直播課程場次、1shop 報名名單、同行者、分組、餐點、延期、課前通知母集合、公開人數看板與上課碼。它與線上 `Course/Enrollment` 不同；場次報名不等於線上觀看授權。

## 2. 範圍與明確不做

- 範圍：場次 CRUD、關鍵字歸類、1shop 匯入、人工報名、名單修正、退款同步、延期／復原、分組、簽到與財務 Sheet、課前通知狀態、board/live 守門。
- 不做：不在本模組計算財務分潤、不直接發 EDM/SMS、不建立 Enrollment、不在公開看板顯示手機／Email。

## 3. 技術環境與約束

- 同場次 `(orderNo, attendeeKey)` 唯一，匯入必須冪等；只收已付款列。
- `SessionSignup` 是「誰來上課」，不得用其 deprecated amount 加總收入。
- 延期原列保留並標記，所有統計、分組、看板及通知排除原列。
- 新舊生統一走 `isRetrainSignup()`；人工覆寫優先。
- 課前通知只在 provider 實際成功後回寫 `smsNoticeAt/emailNoticeAt`。
- `/board` 只有共用 4 位碼，資料敏感度必須受限；`/live` code 綁單一場次。

## 4. 相依與執行順序

1. 場次與報名資料模型；2. 匯入／歸類；3. 名單維護與延期；4. 統計／分組；5. board/live；6. EDM/SMS 名單介面；7. 匯出與測試。

## 5. 資料模型

- `CourseSession`：日期、關鍵字、可見性、組別容量、上課碼與會議資訊。
- `SessionSignup`：訂單／同行者、聯絡資料、餐點、組別、新舊生覆寫、延期與通知時間。
- `BoardLoginThrottle`：看板暴力破解限流。
- 財務模型只以 `(sessionId,orderNo)` 鬆耦合，owner 屬 SPEC-09。

## 6. 角色與權限

| 操作 | 公開使用者 | coach | operator | admin |
|---|---:|---:|---:|---:|
| 看 board | 正確碼後唯讀 | 是 | 是 | 是 |
| 用 live code 取會議資訊 | 正確場次碼 | 是 | 是 | 是 |
| 場次／名單修改與匯入 | 否 | 否 | 是 | 是 |
| 查看後台名單 | 否 | 是 | 是 | 是 |

## 7. 任務清單

- T1 場次 CRUD：日期、關鍵字、可見性、分組容量、上課資訊；刪除需顯示級聯影響。
- T2 匯入：解析 1shop、只收已付款、同行者分列、重傳不重複、退款移除有效名單。
- T3 名單：新增／修改姓名手機、餐點、新舊生、工作人員、組別；個資正規化。
- T4 延期：原場標記、目標場建列、可復原；不得重複通知原場。
- T5 分組：排除 staff／延期列，尊重逐組容量與人工組別。
- T6 通知介面：提供 ALL/PENDING 最新名單，EDM 與 SMS 各自只回寫成功者。
- T7 board/live：限流、session cookie、過期場次下架、code 驗證與最小資料揭露。
- T8 匯出與測試：簽到表、財務表授權，匯入／名單／通知／live DB 回歸。

## 8. 驗收標準

| 編號 | 條件 |
|---|---|
| AC-01 | 同一 1shop 檔重傳不重複報名者，同行者仍各自一列 |
| AC-02 | 未付款不匯入；退款及延期者不進有效統計、分組、看板與原場通知 |
| AC-03 | 人工新舊生覆寫後重匯不被產品文字蓋回 |
| AC-04 | 自動分組遵守逐組容量並排除 staff |
| AC-05 | 新報名者可由 PENDING 通知補發，已成功者不重寄，失敗者仍保留 |
| AC-06 | EDM 與 SMS 通知完成度各自獨立 |
| AC-07 | board 錯碼受限流且永不顯示手機、Email、會議密碼 |
| AC-08 | live code 只能取得該場會議資料，停用／錯碼無法取得 |
| AC-09 | 場次報名不自動建立 Enrollment |
| AC-10 | session import/roster/notice/live tests、typecheck、lint、build 通過 |

## 9. 非功能需求與 Agent 指示

- 台北時區顯示與日期下架規則需一致。
- 不得把財務訂單與一人一列的 signup 合併。
- 修改通知母集合時必跑 EDM 與 SMS 回歸。
- 待確認：刪除場次是否改封存；未確認前保留現行行為但 UI 必須揭露影響。
