# SPEC-15｜講座索取

## 0. 文件資訊
版本 v0.1 Draft；日期 2026-08-29；路由 `/webinar/[slug]`、`/admin/webinars`。

## 1. 概述
訪客提交姓名與 Email 後收到不公開的講座連結，系統保存索取紀錄、可加入指定 EDM 群組並追蹤寄送狀態。公開頁不得直接洩漏 lecture URL、meeting id/password。

## 2. 範圍與明確不做
- 範圍：講座 CRUD、DM、上下架、索取表單、限流、寄信、會議資訊、名單加入、索取記錄維護與 Resend 狀態。
- 不做：不建立會員、Enrollment 或付費訂單；刪除索取記錄不回溯刪除 EDM 群組；不公開會議秘密。

## 3. 技術環境與約束
- slug 唯一小寫英數連字號；lecture/dm 只允許 http(s)。
- 同 webinar/email 唯一，重複索取更新 sentCount；60 秒冷卻。
- 蜜罐觸發對外裝成功，不入庫不寄信；log 去敏。
- endDate 以台北日結束，unpublishAt 精確時間；任一到期即關閉。
- delivery 狀態只升不降；bounce/complaint 終態。

## 4. 相依與執行順序
CRUD → 公開有效性 → 表單驗證／防濫用 → 記錄／名單／寄信 → webhook → 後台維護 → 測試。

## 5. 資料模型
`Webinar` 保存頁面與秘密會議資料、Email 內容及軟連結 groupId；`WebinarRequest` 保存 normalized Email、次數、最後寄送與 delivery 狀態。

## 6. 角色與權限
訪客只可對有效 slug 索取；coach 可查看；Editor 管理講座與索取名單。公開回應不可透露某 Email 是否曾索取。

## 7. 任務清單
- T1 CRUD 驗證、上下架與刪除級聯警告。
- T2 索取：蜜罐、欄位長度、Email、有效性、60 秒限流。
- T3 Email：`{link}/{name}/{email}`、安全 HTML、補 CTA、會議資訊、webinar tag。
- T4 記錄與群組：upsert request、寄送結果、MailGroup 冪等；定義部分失敗補償。
- T5 webhook：驗簽、狀態 rank、錯誤摘要與冪等。
- T6 後台修正／刪除與測試。

## 8. 驗收標準
| 編號 | 條件 |
|---|---|
| AC-01 | 無效、停用或到期講座不寄信且不洩漏連結 |
| AC-02 | 同 Email 60 秒內重送不再次寄信或轟炸 |
| AC-03 | 同 webinar/email 始終一筆，sentCount/lastSentAt 正確 |
| AC-04 | 公開 HTML／回應不含原始會議秘密 |
| AC-05 | 寄信內容正確合併且防 HTML 注入 |
| AC-06 | 指定群組加入冪等，刪 request 不刪群組成員 |
| AC-07 | webhook 重送冪等且狀態不倒退 |
| AC-08 | 無權限者不能查看名單或修改講座 |
| AC-09 | webinar/email/webhook tests、typecheck、lint、build 通過 |

## 9. 非功能需求與 Agent 指示
寄信失敗需讓使用者可安全重試；跨 request／group／send 的一致性要記錄可補償狀態。待確認資料保留期限與刪除講座策略，未決前刪除需顯示 request 數。
