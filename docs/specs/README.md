# 功能模組 SPEC 索引

更新日期：2026-08-29

本目錄的 SPEC 是 Coding Agent 的功能契約；`docs/ARCHITECTURE.md` 說明全站架構，`docs/MODULARIZATION_PLAN.md` 說明程式拆分方向，兩者不能取代功能 SPEC。

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
