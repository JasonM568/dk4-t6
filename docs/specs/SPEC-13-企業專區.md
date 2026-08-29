# SPEC-13｜企業專區

## 0. 文件資訊
版本 v0.1 Draft；日期 2026-08-29；kind=`BUSINESS`；路由 `/admin/zones`、`/zone/[slug]`。

## 1. 概述
企業專區管理企業包班內容的可見性、會員名單、邀請碼與專區課程。可見性與觀看權限不同：一般企業專區會員看得到專區，但仍需 Enrollment；限時開放期間才有名單觀看例外。

## 2. 範圍與明確不做
- 範圍：專區 CRUD/主題、會員匯入、邀請碼、課程歸屬、限時開放、自動開通與前台擋牆。
- 不做：不處理訂閱金流、一般課程付款、EDM 群組；不把加入專區等同永久 Enrollment。

## 3. 技術環境與約束
- slug 唯一；停用專區前台 404；色碼僅 `#RRGGBB`。
- Course 掛 groupId 後立即從公開型錄與 checkout 排除。
- 會員以 normalized Email、`(groupId,email)` 唯一；可先於註冊存在。
- 邀請碼 8 碼易讀、全域唯一、可停用／過期；usedCount 不是上限。
- groupId 刪除對 Course 是 SetNull，永久刪除前須防止專區課程意外變公開。

## 4. 相依與執行順序
專區 → 會員／邀請 → 課程歸屬 → 可見性 → Enrollment／限時例外 → 前台 → 測試。

## 5. 資料模型
`CourseGroup(kind=BUSINESS)`、`CourseGroupMember`、`GroupInviteCode`、`Course.groupId/openToGroupUntil`。userId 只作稽核，實際會籍以 Email 唯一列為準。

## 6. 角色與權限
公開者只能看擋牆；專區會員看專區；staff 可預覽；coach 唯讀；operator/admin 維護。邀請碼與批次名單不得由公開 client 任意建立。

## 7. 任務清單
- T1 專區 CRUD、類型固定 BUSINESS、停用與刪除保護。
- T2 會員單筆／批次匯入、去重、移除與來源追蹤。
- T3 邀請碼產生、兌換、停用、到期與並發冪等。
- T4 課程加入／移出專區，公開可見性立即一致。
- T5 限時開通：到期前名單會員可看並盡力補 Enrollment，到期後只認 Enrollment。
- T6 前台擋牆、主題與最小個資揭露。
- T7 zone/access/registration tests。

## 8. 驗收標準
| 編號 | 條件 |
|---|---|
| AC-01 | 專區課程不公開販售，非會員無法看專區內容 |
| AC-02 | 加入專區本身不建立一般永久觀看權限 |
| AC-03 | 同 Email 重匯／重兌換不重複會員 |
| AC-04 | 停用／過期邀請碼不能兌換，並發兌換仍冪等 |
| AC-05 | 限時開放到期前後觀看規則正確切換 |
| AC-06 | 移除會員立即失去僅由名單提供的資格 |
| AC-07 | 刪除專區不會讓原專區課程意外公開販售 |
| AC-08 | 無權限者不能匯入、匯出、建碼或改課程歸屬 |
| AC-09 | zone/access/auth tests、typecheck、lint、build 通過 |

## 9. 非功能需求與 Agent 指示
Email 正規化只走共用函式；大量會員 createMany；邀請碼不可預測。修改觀看規則需同步 SPEC-06。待確認專區刪除改封存，未決前不得提供無保護硬刪除。
