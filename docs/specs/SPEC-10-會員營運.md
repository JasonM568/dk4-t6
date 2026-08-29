# SPEC-10｜會員營運

## 0. 文件資訊

| 欄位 | 內容 |
|---|---|
| 版本／日期 | v0.1 Draft／2026-08-29 |
| 路由 | `/admin/members`、member detail/import/inactive、`/admin/enrollments` |
| 定位 | 跨 Identity、Learning Access、Zones、EDM 的營運協調模組 |

## 1. 概述

本模組提供後台會員搜尋、新增、批次匯入、電話回填、初始密碼管理、課程與專區批次操作。會員（有 Auth 帳號）與學員資料庫（可能未註冊的歷史記錄卡）是不同資料集合，不得因名稱相近而混用或刪除。

## 2. 範圍與明確不做

- 範圍：會員列表／搜尋、跨名單來源追蹤、新增／匯入帳號、初始密碼、電話、課程授權、加入 EDM 群組／專區、停用帳號清單。
- 不做：不擁有 auth/profile、Enrollment、MailGroup 或 Zone 資料；不直接刪除 Auth 使用者；不把 MailGroup 當觀看權限。

## 3. 技術環境與約束

- `public.profiles` 唯讀，course 資料以 userId／normalized Email 應用層拼裝。
- `MemberPassword` 明碼初始密碼是已接受風險，只限 Admin；不得出現在 log/audit detail。
- 一般編輯需 Editor；密碼與權限敏感操作 Full Admin。
- 批次操作逐人回報成功／失敗，不得因單筆錯誤造成不透明的全批結果。

## 4. 相依與執行順序

Identity → 會員搜尋 → MemberProfile／Stats 拼裝 → 新增／匯入 → 待開通認領 → 跨模組批次操作 → audit／測試。

## 5. 資料模型與邊界

- 外部：auth.users、public.profiles。
- 本平台：MemberProfile、MemberPassword、MemberStats。
- 協調：Enrollment/PendingEnrollment、MailGroupMember、CourseGroupMember。
- `StudentRecord` 不因會員資料修改或刪除而自動改動；認領只保存 claimedUserId。

## 6. 角色與權限

coach 可查看允許的會員資訊；operator 可新增、匯入、批次開通與加群組；只有 admin 可查看／重設初始密碼、管理 staff 或執行其他明定敏感操作。

## 7. 任務清單

- T1 列表搜尋：帳號、姓名、Email、手機、群組；另顯示尚未註冊但存在於名單／專區／pending 的軌跡。
- T2 新增／匯入：驗證 Email、密碼、姓名，處理已存在帳號，不建立孤兒 course 資料。
- T3 建帳後認領：PendingEnrollment 與 StudentRecord 冪等認領。
- T4 密碼：Full Admin、明確授權、成功失敗 audit、永不記錄內容。
- T5 批次操作：課程開通、EDM 群組、企業專區各走該 domain service，UI 清楚區分。
- T6 電話回填：只更新對到唯一會員的 MemberProfile，列出未匹配樣本。
- T7 測試：角色、重複帳號、部分成功、認領、跨模組不混淆。

## 8. 驗收標準

| 編號 | 條件 |
|---|---|
| AC-01 | 列表總數、搜尋與分頁／上限不因跨表拼裝失真 |
| AC-02 | 可區分已註冊會員與只存在於名單的聯絡人 |
| AC-03 | 新增／匯入不建立重複 Auth 帳號或孤兒資料 |
| AC-04 | 建帳後 pending 與歷史學員認領正確且冪等 |
| AC-05 | 加入 MailGroup 不會建立 Enrollment，開課不會加入行銷群組 |
| AC-06 | coach 無寫入權；operator 無密碼權；admin 敏感操作有 audit |
| AC-07 | 密碼不進 log、錯誤訊息或 audit detail |
| AC-08 | 電話匯入未匹配者不會錯寫其他會員 |
| AC-09 | 批次部分失敗有逐筆／摘要回饋 |
| AC-10 | member/import/claim/access tests、typecheck、lint、build 通過 |

## 9. 非功能需求與 Agent 指示

- 大名單查詢避免逐會員 N+1。
- 刪除會員帳號需另立資料保留與法遵 SPEC，不得從此模組順手加入。
- 修改 `parseRows` 必須回歸手機、Email、密碼辨識，避免電話被當成密碼。
