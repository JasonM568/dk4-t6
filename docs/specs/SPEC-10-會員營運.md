# SPEC-10｜會員營運

## 0. 文件資訊

| 欄位 | 內容 |
|---|---|
| 版本／日期 | v0.3 Implemented／2026-08-29 |
| 路由 | `/admin/people`、`/admin/people/[kind]/[id]`、`/admin/members`、member detail/import/inactive、`/admin/enrollments` |
| 定位 | 跨 Identity、Learning Access、Zones、EDM 的營運協調模組 |

## 1. 概述

本模組提供後台「學員與名單」統一操作入口，以及會員搜尋、新增、批次匯入、電話回填、初始密碼管理、課程與專區批次操作。會員（有 Auth 帳號）、歷史學員、場次報名者、待開通者與潛在名單仍是不同 domain 的資料；本模組負責拼裝成同一個人的操作視圖，不搬移、複製或刪除來源資料。

本輪首要成功標準：管理者從一門課程進入後，能在同一頁看見所有上課者、註冊狀態與影片權限，並一次完成直接開通或待註冊存底，不必在會員管理、學員資料庫與課程頁之間猜下一步。

## 2. 範圍與明確不做

- 範圍：統一人物搜尋、跨名單狀態摘要、會員列表／搜尋、跨名單來源追蹤、新增／匯入帳號、初始密碼、電話、課程授權、加入 EDM 群組／專區、停用帳號清單、待處理佇列與課程開通導引。
- 不做：不擁有 auth/profile、Enrollment、MailGroup 或 Zone 資料；不直接刪除 Auth 使用者；不把 MailGroup 當觀看權限。
- 不把四類人寫成互斥且永久的單一 `memberType`；分類必須由帳號、履歷、報名、權限與來源事實衍生。
- 不在本模組自製第二套 Enrollment 或人物主檔。

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

### 5.1 統一人物摘要（read model／DTO，非新的真實來源）

`PersonRosterSummary` 至少包含：

- `personKey`：穩定的 UI key；不得被當成跨 domain FK。
- `authUserId`、`studentRecordId`：各自 nullable。
- `name`、`phone`、`email` 及資料來源。
- `registrationStatus`：`REGISTERED`／`UNREGISTERED`／`AMBIGUOUS`。
- `formalHistoryCount`、最近上課與標準課程摘要。
- `engagementTypes`：讀冊會、頻率意識地圖、講座等。
- `watchableCourseCount`、待註冊開通數。
- `legacyAccessStatus`。
- `attentionFlags`：`MISSING_ACCESS`、`IDENTITY_CONFLICT`、`NO_CONTACT`、`LEGACY_TO_MIGRATE` 等。

拼裝優先使用 auth userId／claimedUserId 與 normalized phone；Email 只在唯一且姓名相容時輔助。無法唯一判定時保留兩列或標成 `AMBIGUOUS`，不得自動合併。

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
- T8 統一入口：將後台主入口命名為「學員與名單」，提供姓名／手機／Email 搜尋，列表同時顯示帳號狀態、上課堂數、可觀看數、待開通數、舊官網狀態及來源。
- T9 快速篩選：已註冊會員、已報名未註冊、已上課未註冊、有上課紀錄但無影片權限、有影片權限、仍在舊官網、潛在名單、身分待確認。每個篩選條件需在 service 中有唯一明確定義。
- T10 人物詳情：分成「基本資料」「報名／上課履歷」「影片權限」「其他接觸」「異動紀錄」；影片列可呼叫 SPEC-06 的開通／撤銷 service，但不得直接操作 Prisma Enrollment。
- T11 待辦中心：至少顯示 `已上課未註冊`、`可能漏開通`、`身分衝突`、`舊官網待轉移`；每筆能連回人物或課程處理頁。
- T12 導航防迷路：會員／學員頁提供「查看此人可觀看課程」；場次頁提供「處理課後影片權限」；課程頁提供「查看學員與觀看名單」。完成後返回原課程並保留處理摘要。
- T13 會員封存：Full Admin 可從會員詳情填原因後封存；一般列表預設排除封存者，另有「已封存會員」檢視與解除封存。封存只建立 course schema 的可復原標記，不刪除／ban Supabase Auth，不影響舊官網、訂單、Enrollment 或歷史履歷；禁止封存自己與其他 admin。

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
| AC-11 | 以同一搜尋入口可找到已註冊會員、未註冊歷史學員與潛在名單，且來源狀態清楚 |
| AC-12 | 一位人物頁能分別回答「是否註冊、上過哪些課、可看哪些影片、是否仍在舊官網」 |
| AC-13 | 上過課但未註冊者顯示待註冊／可建立 pending，不被誤顯示為已開通 |
| AC-14 | 只有讀冊會／問卷接觸者顯示為潛在名單，不被計入正式上課堂數 |
| AC-15 | 從場次到課程開通可沿單一路徑完成，完成報告可回查直接開通、待註冊與待人工確認人數 |
| AC-16 | 共用 Email 或姓名衝突不會把兩人合併或把影片權限開給錯誤帳號 |
| AC-17 | MailGroup、企業專區、上課履歷與 Enrollment 在 UI 文案及操作上明確區分 |
| AC-18 | 封存會員預設不出現在一般列表，可於封存檢視找到並解除；共用 Auth、舊官網登入、訂單與影片權限均不受影響 |
| AC-19 | operator／coach、本人及 admin 目標不能被封存，封存與解除皆留下 AdminAuditLog |

## 9. 非功能需求與 Agent 指示

- 大名單查詢避免逐會員 N+1。
- 刪除會員帳號需另立資料保留與法遵 SPEC，不得從此模組順手加入。
- 修改 `parseRows` 必須回歸手機、Email、密碼辨識，避免電話被當成密碼。
- 統一入口的大名單查詢必須採批次查詢或資料庫 read model；禁止對每列逐一呼叫 Auth、Enrollment、StudentRecord 造成 N+1。
- 第一階段不做自動人物合併；待身分衝突預覽、audit 與可復原策略另立 SPEC 後再啟用。

## 10. v0.3 實作補充（統一人物與待辦中心）

- `src/lib/person-roster.ts` 是跨來源唯讀 DTO 與所有快速篩選／待辦旗標的唯一判定處；`src/lib/person-roster-data.ts` 用批次查詢組裝，列表不做逐人查詢。
- `/admin/people` 同時查找會員、歷史學員與未認領 `PendingEnrollment`，並提供已註冊、未註冊、上過課未註冊、待開通、可能缺權限、有影片、舊站、潛在、身分衝突與封存篩選。
- 待辦中心第一版內嵌於統一入口頂端，數字可直接下鑽至對應人物清單；人物列一律連至完整資料頁。
- 人物頁分開顯示基本資料、正式歷史、活動接觸、場次報名、待開通與平台影片權限。場次報名依 normalized Email 提示，明示共用信箱需人工確認。
- 只有 `claimedUserId` 會合併人物。Email／手機匹配只顯示候選；Full Admin 勾選確認後才可連結，且寫入 `StudentDataAuditLog/STUDENT_CLAIM`。同一會員已有其他學員卡時拒絕連結。
- 人物頁影片操作沿用 SPEC-06 的 `grantEnrollmentAction`／`revokeEnrollment`，不建立第二套授權資料。
- 人物頁提供 Full Admin 專用的名單永久刪除區。已註冊且有 Enrollment（含未認領但同 Email 候選會員）時必須阻擋；其餘只刪 SPEC-03 的 StudentRecord 卡片，絕不刪會員登入帳號。
- 統一入口提供「可安全刪除」快速篩選與最多 50 筆的批次預覽。預覽／結果皆分開顯示可刪、權限保護、身分待確認與失敗，實際刪除規則與稽核由 SPEC-03 service 負責。
- 「疑似測試名單」只依姓名／Email 的強測試標記產生候選並顯示理由；單純沒有歷史資料不足以判定為測試，且候選標記永遠不觸發自動刪除。
- 重複學員卡只由 Full Admin 人工合併：必須共享 Email 或手機；手機不同、已連結不同會員時拒絕。保留卡吸收非重複歷史／接觸紀錄，重複子紀錄略過，來源卡刪除，兩端均留 audit；Auth、Enrollment 不移動。
- 「重複待確認」頁集中列出同姓名同 Email 群組，顯示差異與推薦保留卡，可直接逐筆人工合併；合併後返回清單並重新計算，不提供全自動合併。
- 舊官網搬遷頁支援 CSV／XLSX 預覽後匯入，顯示課名已對照／未對照、建立／更新／歷史／衝突結果與各 legacy status 完成度；未對照課名保留原文，不做模糊猜測。

### 待確認但不阻擋第一階段

1. 舊官網是否能匯出仍有效的帳號／觀看課程清單；未取得前僅提供人工狀態。
2. 「已上課」未來是否以簽到為準；目前場次若沒有簽到資料，需清楚標成「有效報名名單」而非宣稱實際到課。
3. 潛在來源第一期先支援讀冊會與頻率意識地圖，其他活動以 `OTHER` 保存，後續再補來源 adapter。
