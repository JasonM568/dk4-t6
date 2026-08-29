# 功能模組 SPEC 索引

更新日期：2026-08-29

本目錄的 SPEC 是 Coding Agent 的功能契約；`docs/ARCHITECTURE.md` 說明全站架構，`docs/MODULARIZATION_PLAN.md` 說明程式拆分方向，兩者不能取代功能 SPEC。

## 2026-08-29 名單與課程開通優化決策

平台不得再把所有對象統稱為同一種「會員名單」。產品介面以「人」為中心呈現，但底層資料仍由各業務模組各自擁有：

| 使用者看見的狀態 | 判定依據 | 資料 owner | 對應 SPEC |
|---|---|---|---|
| 已註冊會員 | Supabase Auth／profile 存在 | Identity | SPEC-04 |
| 已報名、尚未註冊 | 有有效場次報名或待開通，但無 Auth 帳號 | Sessions／Learning Access | SPEC-08、SPEC-06 |
| 歷史學員 | `StudentRecord` 有上課履歷，可能尚未註冊或仍在舊官網 | Student Database | SPEC-03 |
| 潛在名單 | 只參加讀冊會、講座、問卷等接觸活動，尚無正式課程履歷 | Student Database／來源模組 | SPEC-03 |

四種狀態不是互斥且永久的分類；同一人會隨報名、上課、註冊與授權而轉換。UI 必須分開顯示「帳號狀態」「報名／上課事實」「新平台影片權限」「舊官網狀態」，不得用單一 `memberType` 取代這些事實。

跨模組操作入口由 **SPEC-10 會員營運**負責；它只拼裝與協調，不複製 Auth、StudentRecord、SessionSignup、Enrollment 或 PendingEnrollment。影片能否觀看的唯一業務依據仍是 SPEC-06 的 `Enrollment`（以及已明定的專區例外）。

### 本輪建議實作順序

1. SPEC-03：補足學員主檔、歷史課程、潛在接觸來源與舊官網狀態。
2. SPEC-04：強化註冊後身分認領與歧義佇列。
3. SPEC-06：建立「已開通／待註冊／可能漏開通」查核模型與統一授權服務。
4. SPEC-08：提供有效報名／已上課事實給跨模組查核，不自行授權影片。
5. SPEC-10：完成「學員與名單」統一入口及課程開通直線流程。

## 建立順序與狀態

| 優先序 | 文件 | 模組 | 狀態 |
|---:|---|---|---|
| 已完成 | SPEC-01、SPEC-02 | EDM／Email 行銷 | 已實作 |
| 1 | SPEC-04 | 身分認證與會員資料 | Draft |
| 2 | SPEC-05 | 後台權限與稽核 | Draft |
| 3 | SPEC-06 | 學習與觀看權限 | Draft |
| 4 | SPEC-07 | 訂單與金流 | Draft |
| 5 | SPEC-03 | 學員資料庫維護 | Draft |
| 6 | SPEC-08 | 場次報名與看板 | Draft |
| 7 | SPEC-09 | 場次收支與分潤 | Draft |
| 8 | SPEC-10 | 會員營運 | Draft |
| 9 | SPEC-11 | SMS 簡訊行銷 | Draft |
| 10 | SPEC-12 | 課程目錄與內容 | Draft |
| 11 | SPEC-13 | 企業專區 | Draft |
| 12 | SPEC-14 | 訂閱專區與每日簡報 | Draft |
| 13 | SPEC-15 | 講座索取 | Draft |
| 14 | SPEC-16 | 企業包班詢問 | Draft |
| 15 | SPEC-17 | 網站內容與設定 | Draft |
| 16 | SPEC-18 | 會員等級 | Draft |
| 17 | SPEC-19 | 媒體與檔案 | Draft |
| 18 | SPEC-20 | 平台基礎設施 | Draft |

`SPEC-03` 先於全站盤點建立，因此文件編號與補建優先序不同；不得為排序而重新編號，避免既有引用失效。

## 共通真實來源

1. 現行程式與 Prisma schema 是現況證據。
2. 已確認的 SPEC 是產品契約。
3. `docs/ARCHITECTURE.md` 是跨模組架構契約。
4. `CLAUDE.md` 是開發安全規則。
5. README 有 Auth.js 等過時描述；衝突時不得採用 README，應先修正文件或請產品負責人確認。
