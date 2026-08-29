# SPEC-19｜媒體與檔案

## 0. 文件資訊
版本 v0.1 Draft；日期 2026-08-29；涵蓋 Supabase Storage 簽名上傳、圖片／教材 URL、YouTube、Google Slides／Canva embed。

## 1. 概述
本模組提供其他業務模組安全使用媒體的共用 adapter，不擁有課程、文章或講座資料。核心是 Server 授權後簽發最小範圍上傳 URL、限制格式／大小／路徑，並安全正規化嵌入網址。

## 2. 範圍與明確不做
- 範圍：圖片與教材上傳、bucket/path、public URL、MIME/size、YouTube id、Slides/Canva embed、刪除策略。
- 不做：不提供任意檔案管理器、不把 secret key 給 client、不代理任意外部 URL、不負責業務資料 CRUD。

## 3. 技術環境與約束
- Supabase secret client 只能 server-only；簽名 URL 需短效且 path 唯一。
- 圖片白名單 JPEG/PNG/WebP/GIF；各用途需 size limit；不能只信副檔名／client MIME。
- 檔名不得含 traversal；Server 產生 storage key。
- 外部與 embed URL 只允許明列 provider/https；拒絕 javascript/data（必要的已驗證 data 除外）。
- CSP img-src/media-src/frame-src 與實際 provider 同步。

## 4. 相依與執行順序
Server auth → upload policy → signed URL → DB 保存 public URL → render/embed sanitizer → lifecycle cleanup → 測試。

## 5. 資料模型與公開介面
無獨立 business table；URL 由 Course、Material、CustomPage、Knowledge、Webinar、DailyBrief 等 owner 保存。公開介面應依用途命名，不提供無限制 `uploadAnything()`。

## 6. 角色與權限
公開者只讀已發布內容引用的媒體；coach 不上傳；Editor 可在其可編輯 domain 要求簽名 URL；Full Admin 管站台內容。Storage policy 與 Server guard 都需生效。

## 7. 任務清單
- T1 定義用途別 MIME、大小、bucket、path 與角色矩陣。
- T2 Server 驗證後簽 URL；client 直傳並只回傳可接受 URL。
- T3 magic bytes／解析上限與檔名安全；CSV/XLSX 另走 importer policy。
- T4 YouTube、Slides、Canva URL 正規化與安全 embed。
- T5 孤兒檔策略：替換／刪除業務資料時可追蹤清理，禁止誤刪共用 URL。
- T6 CSP、上傳與渲染測試。

## 8. 驗收標準
| 編號 | 條件 |
|---|---|
| AC-01 | 未授權者不能取得有效上傳 URL |
| AC-02 | 非白名單 MIME、超限檔、偽造副檔名與 traversal 被拒絕 |
| AC-03 | secret/service key 不進 client bundle、URL 或 log |
| AC-04 | 上傳路徑不可覆蓋他人既有檔案 |
| AC-05 | embed 只接受允許 provider，惡意 URL 不渲染 |
| AC-06 | CSP 與允許來源一致，不需放寬為 `*` |
| AC-07 | 刪除／替換不誤刪仍被引用的媒體 |
| AC-08 | upload/embed/CSP tests、typecheck、lint、build 通過 |

## 9. 非功能需求與 Agent 指示
圖片應設尺寸、lazy loading 與 alt；大檔不經 Server memory 中轉。待確認各用途上限與孤兒清理週期，未決前不可自動批量刪檔。
