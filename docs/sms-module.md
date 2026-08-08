# 簡訊模組 — 架構說明

後台路徑 `/admin/sms`。設計刻意對照 EDM（見 `docs/edm-module.md`），兩者的排程、認領、去重、預覽機制是同一套。

> **目前狀態：第一階段，尚未接簡訊商。**
> `SMS_PROVIDER` 未設定時走 dry-run，完整跑完流程但**不送出任何簡訊、不花任何錢**。
> 已完成：上課提醒（場次報名者／手動名單）、字數則數與金額試算、排程、花費上限、退訂名單。
> 尚未完成：真實簡訊商 adapter、招生行銷推播、名單群組加手機、退訂短連結。

---

## 1. 資料表

| Model | 用途 | 關鍵欄位 |
|---|---|---|
| `SmsBroadcast` | 一次發送的紀錄（草稿／排程／已發送） | `messageType`、`audienceType`、`sessionIds[]`、`recipients[]`、`claimedAt`、`provider` |
| `SmsOptOut` | 退訂／無法送達名單 | `mobile @id`、`source` |

手機號碼本身存在 `SessionSignup.phone`（來自 1shop 訂單匯入與手動報名），一律正規化為 `09XXXXXXXX`。

**沒有外鍵**，與 `EmailBroadcast` 同樣的軟連結慣例：場次被刪除時，歷史發送紀錄仍完整保留。

### 為什麼金額欄位存「分」

專案慣例是金額用整數元，但簡訊單價低於 NT$1（約 0.7～1.0），存整數元會全部四捨五入成 0 或 1，估算會完全失真。`unitPriceCents` / `estimatedCostCents` 是刻意的最小偏離。

---

## 2. 手機號碼正規化

`src/lib/sms/phone.ts`，標準格式**本地 `09XXXXXXXX`**（不是 E.164）。

理由：現有資料已是這個格式（零遷移）；台灣簡訊商 API 也吃這個格式；而且去重鍵＝顯示值＝人工輸入值，只有一種表示法要記。日後若要改 E.164，只需改這支檔案加 adapter 一行——只有 adapter 會把號碼格式化上線。

處理順序：全形數字→半形 → 去零寬字元/NBSP → 只留數字 → 剝除 `+886`/`886`/`00886` → 9 碼且以 `9` 開頭才補前導 0 → 驗 `^09\d{8}$`。

**核心原則：模稜兩可一律拒絕，不猜。** 這是會花錢的模組。

| 輸入 | 結果 |
|---|---|
| `0912-345-678`、`（0912）345678`、全形數字 | `0912345678` |
| `+886912345678`、`00886912345678` | `0912345678` |
| `912345678`（Excel 掉前導零） | `0912345678` |
| `02-2700-1234` | 拒絕（市話收不到簡訊） |
| `227001234`（市話掉零） | 拒絕——**刻意不猜**，補了就是一個錯號碼 |
| `0912345678#123`（分機）、一格兩號 | 拒絕 |

每一筆被拒絕的都會變成畫面上可見的「N 人無手機／市話」，不會無聲消失。

---

## 3. 名單解析：單一漏斗

`src/lib/sms/dispatch.ts` 的 `resolveMobiles()`，對照 EDM 的 `resolveRecipients()`：

```
各來源名單（依勾選順序排序）
  → dedupeByMobile()   正規化 → 驗證 → 以手機去重（保留第一筆姓名）
  → filterOptedOut()   依 messageType 決定扣哪些退訂
  → 花費上限檢查       超過→ FAILED，零發送零花費
  → sendSms()
```

**去重只有這一個地方。** 任何新的名單來源都要匯進這條路。

`previewSmsAudience()` 走完全相同的路徑，所以後台顯示的「實際可發 N 人」就是發送後的 `sentCount`。

**勾選順序有意義**：`collectSessionSignups()` 依勾選順序排序，因為去重是先到先贏——跨場次重複報名的學員，`{name}` 會取排在前面那個場次登記的姓名。`findMany` 不保證順序，必須自己排。

### audienceType

| 值 | 名單來源 | 狀態 |
|---|---|---|
| `SESSION` | `SessionSignup`，可複選場次 | ✅ 已接線（上課提醒） |
| `MANUAL` | 紀錄自身的 `manualRows` | ✅ 已接線 |
| `GROUP` | `MailGroupMember.phone` | ⏳ 第二階段 |

**永遠不會有 `ALL`**：會員資料表沒有手機欄位（而且那張表歸另一個系統管，本專案唯讀），而且「簡訊轟炸全體會員」本來就不該存在。

---

## 4. 兩種訊息類型

|  | `NOTICE` 上課提醒 | `MARKETING` 招生推播 |
|---|---|---|
| 品牌前綴 | ✅ | ✅ |
| 退訂連結 footer | ❌ | ✅（第二階段） |
| 扣 `USER`/`MANUAL` 退訂 | ❌ | ✅ |
| 扣 `INVALID`（空號/停用） | ✅ | ✅ |
| 額外確認 | 需勾選履約聲明 | 需金額確認 |

**這是與 EDM 最重要的差異。** EDM 裡一次退信＝永久全面抑制；簡訊不行——學員退訂行銷推播，不代表放棄他自己付費課程的上課通知（那是履約通知）。但空號則兩者都該擋。所以過濾條件看的是 `source`，不是「有沒有這筆資料」。

分支刻意寫在 `filterOptedOut()` 這個單一漏斗裡，任何呼叫端都不可能繞過。

**目前 UI 只開放 `NOTICE`**：行銷推播依 NCC 規定須提供免費退訂方式，退訂短連結完成前不開放。

---

## 5. 字數與計費

`src/lib/sms/message.ts`。純英數（GSM-7）160 字/則、分段 153；含中文（UCS-2）**70 字/則、分段 67**，台灣簡訊商以此計費。

三個容易算錯的地方：

1. **以 `text.length`（UTF-16 code unit）計算**，不是 `[...text].length`——後者會把 emoji 算成 1，實際計費是 2。
2. **內文擋掉 emoji**：代理對跨分段邊界會被電信業者移位，實際則數可能比公式多一段（＝多一筆錢）。與其建模不如擋掉，台灣各電信商對 emoji 的呈現本來就不一致。
3. **GSM-7 擴充字元**（`^ { } [ ] ~ \ | €`）佔 2 個字元額度。

`composeSmsText()` 是發送與後台預覽**共用的同一支函式**，否則預覽則數會跟帳單對不起來。

### 字數預算的現實

實測：`【希望學院】`（6 字）＋ 退訂 footer（`\n拒收 https://course.huangxi.info/u/XXXXXXXX` 約 41 字）＝ **47 字合規開銷**，70 字的第一段只剩 23 字能放內容。

**一則合規的行銷簡訊實務上是 2 則的成本。** 若之後行銷量大，換一個短網域（`course.huangxi.info` 19 字 → 短域名 7 字）是單筆最有效的省錢手段。上課提醒不帶 footer，所以沒有這個問題。

### 單價與上限存哪裡

`SiteSetting`，不是環境變數——費率隨合約變動，改價不該需要重新部署，而且談價格的人是管理員不是工程師。

| key | 預設 | 說明 |
|---|---|---|
| `sms:pricePerSegment` | 1.0 | 每則單價（元） |
| `sms:dailyLimit` | 2000 | 單日則數上限 |
| `sms:singleSendLimit` | 500 | 單次發送則數上限 |
| `sms:brandPrefix` | `【希望學院】` | 簡訊開頭標示 |

`SiteSetting.value` 是自由文字，解析一律 clamp + fallback——絕不能讓 `NaN × 人數 × 單價` 跑出去。

---

## 6. 花費防線

這是專案裡唯一會花錢的模組，沒有先例可循。四道防線：

1. **dry-run 是預設。** 未設定 `SMS_PROVIDER` 就不會有任何東西離開伺服器。紀錄照常寫入但標記 `provider="dryrun"`，列表以紫色徽章標示「測試模式（未實際發送）」——不能讓人看到綠色的「已發送 23 人」卻不知道根本沒送出去。
2. **發送前確認面板**：人數、無手機人數、則數、預估金額，全部攤開在按鈕上方，再加一層 `confirm()`。
3. **則數上限擋在 `executeSmsBroadcast()` 裡，不是擋在 server action。** 這是本模組最重要的結構決策：排程是**發送當下**才解析名單，一封週五排定、週一發送的簡訊，名單可能從 50 人長成 5000 人——擋在 action 會被完全繞過。超過上限一律整批不送（`status=FAILED`），不會送一半。
4. **永不自動重寄。** 卡在 `SENDING` 超過 15 分鐘的紀錄標為 `FAILED`，由人決定要不要重發。對 email 這條規則是避免騷擾，對簡訊是避免**再付一次錢**。

已知限制（接受而非過度設計）：兩個併發發送可能各自通過每日檢查而合計超標。有單次上限兜底，且 cron 是序列處理、後台發送本來就少，不值得為此加鎖。

---

## 7. 排程

**沒有另開 cron。** 現有的 `/api/cron/broadcast`（每 5 分鐘）多呼叫一次 `processDueSmsBroadcasts()`，回應變成 `{ email: {...}, sms: {...} }`。兩者排程機制完全相同，共用可以少一個會動的零件。簡訊處理包在 try/catch 裡，失敗不影響 email 排程。

時間一律台北：`new Date(\`${raw}:00+08:00\`)`，且必須 ≥ 現在 +60 秒。

---

## 8. 簡訊商串接

### 8.0 已接：MAAC Go（漸強實驗室，2026-08-08）

`src/lib/sms/provider/maacgo.ts`——台灣三大電信直連、NCC 合規內建、NT$0.78/段（中文 70 字/段）。

- **啟用**：`.env` 設 `SMS_PROVIDER=maacgo` + `MAACGO_API_KEY=sk_live_...`（Vercel 同步設定後 redeploy）。
  金鑰在 <https://sms.cresclab.com> Dashboard → 🤖 MCP / API 建立；新帳號送 NT$50 試用額度
- `sk_test_` 金鑰視為非 live（`isLive=false`），後台紀錄標「測試金鑰（不實際發送）」；
  憑證缺漏不 throw，逐筆回失敗＋中文原因（頁面不會 500）
- 逐通打 `POST /sms/send`（`type: "notification"`）：內容是逐人渲染，broadcast 端點對不上逐筆對應約定。
  批 10 通、批間 1 秒；429/5xx 走 `postWithRetry` 退避
- 錯誤碼對應中文：`insufficient_balance`（餘額不足去儲值）/ `ncc_blocked`（含封鎖原因）/ `rate_limited`
- `MAACGO_TEAM`（選填）：MAAC Go 後台成本歸屬報表標籤；`MAACGO_API_BASE`（僅測試）：mock server 覆寫
- **啟用後記得把後台 `sms:pricePerSegment` 調成 78（分）**，並先發一則給自己驗證
- 送達回報：MAAC Go 有 `sms.delivered`/`sms.failed` webhook（HMAC-SHA256 簽章），第一階段未接——
  要接時參考 `/api/webhooks/resend` 的驗簽做法，事件更新 `SmsBroadcast` 逐筆狀態
- 驗證：`npx tsx --conditions=react-server scripts/test-sms-maacgo.ts`（17 項，mock server 不花錢）

### 8.1 之後要接三竹（或其他簡訊商）該做什麼

介面已經就位，只要補一個檔：

1. 新增 `src/lib/sms/provider/mitake.ts`，`implements SmsProvider`
   - `send(items)` **必須逐筆對應回傳**，長度等於 `items.length`——這是 `send.ts` 能逐筆記錄 `failedRecipients` 的前提
   - HTTP 重試直接用 `src/lib/sms/provider/http.ts` 的 `postWithRetry()`（政策已與 email 對齊：只重試 429/5xx/網路錯誤、15 秒逾時、尊重 `Retry-After`、指數退避）
   - **API URL 要在函式內讀環境變數**，不要用模組層 `const`——EDM 的 `RESEND_BATCH_URL` 就是這個坑，測試腳本會蓋不掉
   - 缺少憑證時**不要 throw**，回傳全部失敗＋中文原因（照 `broadcast.ts:237` 的做法）。module-load throw 會讓整個 `/admin/sms` 頁面 500，在最需要查看紀錄的當下反而看不到
   - 三竹的回應是 ini-like 純文字（`[N] msgid=...;statuscode=...`），不是 JSON
2. `provider/index.ts` 的 switch 加一個 `case "mitake"`
3. `.env` 設 `SMS_PROVIDER=mitake` 與該 adapter 需要的憑證，並補進 `.env.example`
4. 後台調整 `sms:pricePerSegment` 為實際費率
5. **用一則真實測試簡訊驗證**，然後拿第一張帳單校準單價

上游的一切（正規化、漏斗、去重、字數則數、上限、排程、UI）都已用 dry-run 驗證過，不需要重寫。

---

## 9. 驗證

```bash
npx tsx --conditions=react-server scripts/test-sms.ts
```

68 項斷言：手機正規化對照表（含所有該拒絕的案例）、則數邊界（中文 70/71、134/135）、合規文案組裝、端到端 dry-run（預覽人數＝實際發送數、跨場次去重、姓名優先序）、退訂分流（行銷退訂不擋履約通知、空號兩者都擋）、花費上限。

需要 `--conditions=react-server`：`dispatch.ts` 是 `server-only`，純 node 環境下該套件會 throw。

---

## 10. 改這個模組時最容易踩的坑

1. **`"use server"` 檔案只能 export async function**——`phone.ts` / `message.ts` / `audience.ts` / `settings.ts` 刻意不 import `server-only`，因為 client 表單要用它們做即時字數計算
2. **新的名單來源請匯進 `resolveMobiles()`**，不要繞過去重與退訂過濾
3. **改預覽邏輯就要一起改發送邏輯**——兩者共用同一條路徑是刻意的，分岔了數字就會跟帳單對不起來
4. **加欄位要先跑 migration 再部署**：`executeSmsBroadcast` 用不帶 `select` 的 `findUnique`，Prisma 會 SELECT 所有純量欄位。Vercel 的 build 是 `prisma generate && prisma migrate deploy && next build`，推 main 會自動處理順序
5. **`/board` 公開看板不要加手機欄**——它只用 4 位數共用密碼保護，那個信任層級不適合放個資
6. **第二階段的預告**：`MailGroupMember` 要加手機並把 `email` 改為可空（純簡訊聯絡人不該被迫填假信箱，假信箱會硬退信並被 Resend webhook 永久寫進 `MailUnsubscribe`）。那會動到 EDM 正在運作的路徑，合併前要做 EDM 回歸測試。另外 `src/actions/admin.ts` 的 `parseRows` 目前會把單獨的 `0912345678` 判成密碼（規則「≥6 碼且含數字」），要加手機辨識必須用 opt-in 參數，預設維持現行行為
7. **不要自動把 `SessionSignup.phone` 灌進行銷名單**——那是履約用途蒐集的資料，轉作行銷應該是一個明確的人為動作
