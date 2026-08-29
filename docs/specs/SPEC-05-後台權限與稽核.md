# SPEC-05｜後台權限與稽核

## 0. 文件資訊

| 欄位 | 內容 |
|---|---|
| 版本／日期 | v0.1 Draft／2026-08-29 |
| 模組 | Access Control／Admin RBAC／Audit |
| 角色 | admin、operator、coach |
| 狀態 | 現況基線 SPEC，待產品驗收 |

## 1. 概述

本模組是所有後台功能的共同安全地基。有效角色解析優先序為：`public.profiles.role=admin` > course `StaffRole(OPERATOR/COACH)` > 無權限。頁面隱藏不是授權，所有 Server Action、Route Handler 與敏感資料查詢都需獨立守門。

## 2. 範圍與明確不做

### 2.1 範圍
- 後台角色解析、頁面與 Action 守門。
- Admin 指派／移除 Operator、Coach。
- 敏感操作稽核。
- 後台導覽依角色顯示。
- CSV/API 匯出的權限一致性。

### 2.2 不做
- 不管理一般會員登入。
- 不在前端自訂臨時角色。
- 不讓 course `StaffRole` 覆蓋 QBC admin。
- 不在本期做細到每個欄位的自訂 permission builder。

## 3. 技術環境與約束

- 角色型別固定 `admin | operator | coach`。
- `requireStaff()`：三角色可查看；`requireEditor()`：admin/operator；`requireFullAdmin()`：admin。
- 頁面使用對應 page guard；API Route 失敗回 401/403，不用 redirect 偽裝成功。
- `StaffRole.userId` 是 Supabase UUID、無 FK；Email 只是指派快照。
- 權限變更與密碼重設等敏感操作要寫 audit，但不得記密碼。

## 4. 相依與執行順序

1. Identity 提供可信 user。
2. role 純函式定義能力矩陣。
3. staff service 解析角色。
4. Page／Action／API guards。
5. 權限管理頁與稽核。
6. 全路由權限回歸掃描。

## 5. 資料模型

`StaffRole`
- `userId` 唯一；role 僅允許 `OPERATOR`、`COACH`。
- email、assignedBy 為稽核快照。

`AdminAuditLog`
- action、actorId／Email、targetId、success、detail、createdAt。
- detail 不得含密碼、token、完整付款 callback 或其他秘密。

未來若擴充一般資料修改稽核，應另建 domain audit 或通用安全 schema，不把大量個資塞入 `AdminAuditLog.detail`。

## 6. 角色與權限

| 能力 | admin | operator | coach |
|---|---:|---:|---:|
| 進後台與查看允許資料 | 是 | 是 | 是 |
| 一般內容編輯、匯入、匯出、群發 | 是 | 是 | 否 |
| 權限管理、站台設定 | 是 | 否 | 否 |
| 會員密碼重設／查看初始密碼 | 是 | 否 | 否 |
| 場次財務與分潤 | 是 | 否 | 否 |

各 domain SPEC 可再收緊，但不得放寬此矩陣。

## 7. 任務清單

### T1. 角色解析
- QBC admin 永遠是最高角色。
- 非 admin 才查 `StaffRole`；非法 role 值視為無權限。

### T2. 守門介面
- Server Components 用 `requireStaff` 概念或 page guards。
- Server Actions 每個 exported mutation 自行守門。
- Route Handler 下載／匯出回正確 HTTP 狀態。

### T3. 權限管理
- 只有 admin 可搜尋會員並指派／移除 staff。
- 不允許把 admin 降級或用 StaffRole 假造 admin。
- 不允許操作者自行提權。

### T4. 稽核
- 密碼重設、批次重設、角色異動及未來指定敏感動作記 actor、target、結果。
- 失敗操作也記錄安全原因，但內容去敏。

### T5. 全站稽核
- 盤點所有 `/admin` page、Server Action、admin API；前端可見性與後端權限需一致。

## 8. 驗收標準

| 編號 | 條件 |
|---|---|
| AC-01 | 未登入與一般會員不能進入後台或呼叫後台 Action |
| AC-02 | coach 可查看允許頁，但所有寫入、匯入、匯出及群發被拒絕 |
| AC-03 | operator 可一般編輯，但不能管理權限、站台敏感設定、密碼或財務 |
| AC-04 | admin 擁有完整後台能力且不需 StaffRole 資料列 |
| AC-05 | client 隱藏按鈕之外，直接呼叫 Action/API 仍被 Server 拒絕 |
| AC-06 | staff role 非法值不取得任何權限 |
| AC-07 | operator/coach 無法自我提權或建立 admin |
| AC-08 | 敏感成功與失敗操作均有 audit，且不含密碼/token |
| AC-09 | CSV 與財務下載未授權回 401/403 |
| AC-10 | 權限矩陣測試、server action check、typecheck、lint、build 通過 |

## 9. 非功能需求與 Agent 指示

- 新增後台功能必須先選 `Staff/Editor/FullAdmin` 等級並寫進該模組 SPEC。
- 不得以 middleware/proxy 或 UI 作唯一授權。
- 權限拒絕不得在 log 洩漏敏感 payload。
- 待確認：學員永久刪除是否限 admin；在 SPEC-03 定稿前採較嚴格的 admin-only 建議。
