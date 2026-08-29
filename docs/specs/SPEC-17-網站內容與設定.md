# SPEC-17｜網站內容與設定

## 0. 文件資訊
版本 v0.1 Draft；日期 2026-08-29；涵蓋首頁／導覽開關、自訂頁、知識文章、講師／邀約展示與追蹤設定。

## 1. 概述
本模組讓管理員維護非課程交易型內容及全站展示設定。自訂內容必須安全渲染；發布狀態、訂閱可見性與追蹤碼必須由 Server 強制，不得只靠導覽列隱藏。

## 2. 範圍與明確不做
- 範圍：SiteSetting 分頁開關、CustomPage CRUD/導覽、KnowledgeArticle CRUD/發布/可見性、公開展示頁、GA4/Meta Pixel/GTM ID。
- 不做：不管理課程、EDM、訂閱付款或任意 JavaScript；不提供通用 CMS HTML 注入。

## 3. 技術環境與約束
- 管理只限 Full Admin；slug 小寫英數連字號且唯一。
- 內容走既有安全 renderer，禁止 raw HTML/script；URL 只允許 http(s)。
- CustomPage 未發布 404，showInNav 只控制導覽、不等於發布。
- Knowledge status/visibility 白名單；SUBSCRIBER Server 驗證資格。
- Tracking 只保存嚴格格式 ID，不接受整段 script。
- `SiteSetting` key 需有 owner registry，不能互相覆蓋。

## 4. 相依與執行順序
設定 key registry → 自訂頁 → 知識文章 → 可見性 → tracking/CSP → cache revalidation → 測試。

## 5. 資料模型
`SiteSetting` key/value；`CustomPage` slug/content/images/video/publish/nav/order；`KnowledgeArticle` slug/summary/content/tags/visibility/status/publishedAt/unpublishAt。

## 6. 角色與權限
公開者只讀有效公開內容；訂閱會員可讀 subscriber 內容；所有新增、修改、刪除與 tracking 只限 Admin。直連 URL 需與列表相同守門。

## 7. 任務清單
- T1 建立 SiteSetting key owner 對照與型別化存取。
- T2 分頁開關與 navbar/cache 一致。
- T3 CustomPage CRUD、排序、圖片／影片與安全 renderer。
- T4 Knowledge 發布時間、下架、PUBLIC/SUBSCRIBER Server 守門。
- T5 Tracking ID 驗證、停用與 CSP 對齊；不得任意 script。
- T6 刪除確認、引用影響與測試。

## 8. 驗收標準
| 編號 | 條件 |
|---|---|
| AC-01 | 未發布頁面／文章以直連也不可見 |
| AC-02 | showInNav=false 只移除導覽，已發布頁仍可直連 |
| AC-03 | SUBSCRIBER 文章非會員直連仍被拒絕 |
| AC-04 | content/URL 無法注入 script、javascript URL 或破壞 CSP |
| AC-05 | tracking 只接受 GA4/Pixel/GTM 合法 ID，空值停用 |
| AC-06 | 非 Admin 無法修改內容、分頁與 tracking |
| AC-07 | 更新後 root layout、列表與詳細頁 cache 一致 |
| AC-08 | content/access/CSP tests、typecheck、lint、build 通過 |

## 9. 非功能需求與 Agent 指示
前台需 SEO title、可存取性與圖片效能。不得用 SiteSetting 收納秘密。待確認講師／邀約頁是否改為可管理資料；未確認前視為固定前台內容。
