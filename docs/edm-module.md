# EDM 電子報群發模組 — 架構說明

後台路徑 `/admin/broadcast`。這份文件說明模組怎麼串起來，讓下次要改功能時不必重新摸一遍。

---

## 1. 資料表

全部在 `course` schema，定義於 `prisma/schema.prisma`。

| Model | 用途 | 關鍵欄位 |
|---|---|---|
| `EmailBroadcast` | 一次群發的紀錄（含草稿／排程／已寄出） | `audienceType`、`groupIds[]`、`manualRows`、`recipients[]`、`status`、`claimedAt` |
| `EmailBroadcastRecipient` | 逐收件人 provider 結果 | `status`（PENDING/ACCEPTED/FAILED）、`providerMessageId`、`failureReason` |
| `MailGroup` | 名單群組 | `name @unique`（同名視為同一組，建立時會 upsert 合併） |
| `MailGroupMember` | 群組成員 | `email`、`name?`、`@@unique([groupId, email])` |
| `MailUnsubscribe` | 退訂／退信抑制名單 | `email @id`、`source`（USER／BOUNCE／COMPLAINT） |
| `BroadcastEvent` | 成效事件 | `@@unique([broadcastId, email, type])`，type = DELIVERED/OPENED/CLICKED/BOUNCED/COMPLAINED |
| `MailTemplate` | 常用範本 | 只存內容，不存發送對象 |

**重要設計慣例：`EmailBroadcast` 上沒有任何外鍵。** `groupId`、`groupIds`、`sessionIds`、`courseId`、`sourceBroadcastId`、`resendOfId` 全是「軟連結」——指向的東西被刪掉時不會連動刪除群發紀錄，只是查不到而已。`EmailBroadcastRecipient.broadcastId` 也刻意不設 FK。這是刻意的：歷史紀錄要能永久保留，不該因為刪掉一個群組或來源資料就消失。

唯一有 FK 與 cascade 的是 `MailGroupMember → MailGroup`。

> ⚠️ **概念區分**（CLAUDE.md 也有）：`MailGroup`＝寄信名單，`Enrollment`＝課程觀看權限。兩套完全獨立，把人加進名單群組**不會**開通任何課程。

---

## 2. 五種發送對象

`audienceType` 的五個值，以及各自的名單來源：

| audienceType | 表單值 | 名單來源 |
|---|---|---|
| `ALL` | `all` | Supabase `profiles` 全部會員（`listProfiles()`，非 Prisma） |
| `GROUP` | `group` | `MailGroupMember`，**可複選多個群組取聯集** |
| `SESSION` | `session` | `SessionSignup`，**可複選場次取聯集**；已延期者不收原場次通知 |
| `MANUAL` | `manual` / `members` | 存在紀錄自身的 `manualRows` JSON |
| `FOLLOWUP` | `followup` | 來源群發的 `BroadcastEvent` 成效事件 |

「手動貼入名單」與「從會員清單勾選」在資料層是同一種（都是 `MANUAL`），只有 `audienceLabel` 文案不同。

**場次不是課程觀看權限。** `SESSION` 讀的是場次看板的報名資料；若要依某門線上課程的 `Enrollment` 寄送，仍需先透過 `createGroupFromCourseAction` 倒進 `MailGroup`。

### 行銷推播與履約通知

- `MARKETING`：排除 `MailUnsubscribe` 的 USER、BOUNCE、COMPLAINT。
- `NOTICE`：只排除 BOUNCE、COMPLAINT；自行取消訂閱電子報的學員仍能收到已報名課程的上課通知。
- 只有 SESSION、MANUAL 與 UI 的「選取會員」可標 NOTICE。ALL、GROUP、FOLLOWUP 一律是 MARKETING，避免用履約通知繞過退訂。
- 場次通知可使用 `{code}`，逐人帶入該場次的上課碼；複選場次時，同 email 取勾選順序最前場次的姓名與上課碼。

### 跟進信（FOLLOWUP）
四種條件定義在 `src/lib/email/followup.ts`：`OPENED`／`NOT_OPENED`／`CLICKED`／`OPENED_NOT_CLICKED`。
新寄送的四種條件都以 `EmailBroadcastRecipient.status=ACCEPTED` 為母集合，FAILED/PENDING 不會被誤列為跟進對象。舊紀錄沒有逐人結果時才退回 `recipients[]` 快照；太舊且沒有快照的紀錄無法計算 NOT_OPENED。

---

## 3. 名單是「寄出當下」才解析的

這是整個模組最重要的一條規則。表單送出時**只存發送對象的描述**（群組 id、篩選條件），不存名單本身；真正的收件人清單是在寄出那一刻才查出來的。

原因：排程可能是三天後才寄，這三天內群組會有新成員加入、也會有人退訂。寄出當下解析才不會漏人也不會誤寄。

例外：`MANUAL` 的名單本來就是使用者當場貼的，直接存進 `manualRows`。

解析入口是 `src/lib/email/dispatch.ts` 的 `resolveRecipients()`（模組私有）。五路分支匯合後，一律經過：

```
各來源名單
  → dedupeByEmail()      小寫化、trim、email 格式驗證、以 email 去重（先到先贏）
  → filterUnsubscribed() 依 MARKETING/NOTICE 扣掉 MailUnsubscribe，差額記為 excludedCount
  → sendBroadcast()
```

**去重只有這一個地方。** 任何新的名單來源只要匯進這條路，就自動享有去重與退訂過濾——不需要也不應該另外實作。

---

## 4. 複選名單群組（2026-08）

`GROUP` 可勾選多個群組。因為名單群組是以課程場次區分的，同一位學員上過多堂課會同時出現在多個群組，聯集後必須去重。

**資料表**：`EmailBroadcast.groupIds String[]`。舊的 `groupId String?` 保留並持續同步寫入（`= groupIds[0]`），因為 `audienceData` 是用展開語法灌進六個 Prisma write，少寫一個 key 會留下殘值。

**讀取一律走 `broadcastGroupIds()`**（`src/lib/email/audience.ts`）：新欄位優先，空陣列才退回舊的單一 `groupId`。migration 已回填舊資料，這是雙保險。

**勾選順序有意義**：`collectGroupMembers()` 會依勾選順序排序，因為 `dedupeByEmail` 是先到先贏——跨群組重疊的學員，`{name}` 會取排在前面那個群組登記的姓名。`findMany` 不保證回傳順序，所以必須自己排，否則預覽與實際寄出可能叫出不同名字。

**人數預覽**：`previewGroupAudience()` 刻意呼叫與寄送完全相同的 `collectGroupMembers → dedupeByEmail → filterUnsubscribed`，所以後台顯示的「實際可寄 N 人」就是寄出後的 `sentCount`。若哪天要改預覽，務必連同寄送路徑一起改，不要另外寫一份。

**邊界行為**：
- 勾選後群組被刪除 → 送出時擋下要求重選（寧可擋下，也不要默默少寄一批人）
- 部分群組是空的 → 照寄其餘群組（成員數判「總和」而非逐組）
- 全部群組皆空 → 擋下並提示
- 只勾一組時 `audienceLabel` 維持 `群組：X`，與改版前一字不差，歷史紀錄外觀才一致

---

## 5. 排程與 cron

- `vercel.json` 設定 `/api/cron/broadcast` 每 5 分鐘跑一次，需帶 `Authorization: Bearer ${CRON_SECRET}`
- 表單的「預設發送時間」是**台北時間**：`new Date(\`${raw}:00+08:00\`)`，且必須 ≥ 現在 +60 秒
- **原子認領**：cron 以 `updateMany({ where: { id, status: "SCHEDULED" }, data: { status: "SENDING", claimedAt: now } })` 搶單，`count === 0` 就跳過。這是防止兩個 cron 實例同時寄同一封
- 立即寄送也會寫 `claimedAt`，否則會被 cron 的逾時回收誤判
- **逾時回收**：`SENDING` 且 `claimedAt` 超過 15 分鐘（或為 null）的紀錄會被標為 `FAILED`，**不會自動重寄**——寧可漏寄也不要重複轟炸收件人

`status` 流轉：`DRAFT` → `SCHEDULED` → `SENDING` → `SENT`／`FAILED`，另有 `CANCELED`。

逐收件人的 provider 狀態另行流轉：

```
PENDING（已解析，尚未取得 provider 結果）
  → ACCEPTED（Resend 回傳該封 message id；不等同已送達）
  → FAILED（API、網路或個別回傳失敗）
```

若 provider 接受後 serverless 在資料庫回寫前中斷，PENDING 會保留為「結果不確定」，系統不會自動重寄。

---

## 6. 退訂與退信共用同一張表

`MailUnsubscribe` 同時承載三種來源：使用者自行退訂（`USER`）、硬退信（`BOUNCE`）、垃圾信投訴（`COMPLAINT`）。也就是說**一次退信＝永久抑制**，之後所有群發都會自動跳過該地址。

寫入來源：
- 一鍵退訂 `POST /api/unsubscribe`（信件的 `List-Unsubscribe-Post` 標頭）
- 退訂確認頁的 server action
- Resend webhook `/api/webhooks/resend` 收到 bounced/complained

過濾**只發生在 `resolveRecipients` 裡**。測試信與講座索取信不走這條路，因此不受退訂名單影響——這是刻意的（測試信是寄給管理員自己）。

---

## 7. 寄送與重試

`src/lib/email/broadcast.ts` 的 `sendBroadcast()`：

- 走 Resend batch API，每批 100 封，批次間隔 600ms（Resend 限 2 req/s）
- 每封信獨立 `to: [單一地址]`，HTML 逐人渲染（`{name}`／`{email}` 變數替換），不用 BCC
- 只對 429／5xx／網路錯誤重試，最多 3 次、指數退避；其他 4xx 直接判定整批失敗
- HTTP 200 仍會逐筆檢查 `data[j].id`，個別失敗會記進 `failedRecipients`，之後可用「補寄失敗者」重寄（會建立一筆 `resendOfId` 指向原信的 MANUAL 群發）
- 寄送前批次建立 `EmailBroadcastRecipient=PENDING`；完成後以單一 transaction 批次收斂為 ACCEPTED/FAILED
- `EmailBroadcast.recipients[]` 為相容欄位，新寄送只保存 ACCEPTED email；完整結果以 `EmailBroadcastRecipient` 為準
- `BroadcastEvent` 的 DELIVERED/OPENED/CLICKED/BOUNCED/COMPLAINED 是 provider 後續事件，不和 ACCEPTED 混為同一狀態

`RESEND_BATCH_URL` 可用環境變數覆寫，供本機 mock 測試。**注意它是模組載入時就固定的 `const`**，測試腳本必須在 import 之前設定環境變數。

---

## 8. 檔案地圖

| 檔案 | 職責 |
|---|---|
| `src/lib/email/dispatch.ts` | 名單解析、去重、退訂過濾、`executeBroadcast`、cron 的 `processDueBroadcasts`（`server-only`） |
| `src/lib/email/broadcast.ts` | 實際打 Resend API、HTML 組版、變數替換 |
| `src/lib/email/audience.ts` | `broadcastGroupIds()` 與預覽型別（**非** server-only，client component 可 import 型別） |
| `src/lib/email/followup.ts` | 跟進條件常數與 ACCEPTED 母集合純函式（獨立成檔是因為 `"use server"` 檔不能 export 常數） |
| `src/lib/email/unsubscribe.ts` | 退訂連結的 HMAC token |
| `src/actions/admin.ts` | 所有 server action；`resolveBroadcastAudience()` 是表單→`audienceData` 的轉換點 |
| `src/app/(admin)/admin/broadcast/broadcast-form.tsx` | 群發表單（client，`useActionState`），新增/編輯共用 |
| `src/app/(admin)/admin/broadcast/[id]/page.tsx` | 群發明細：成效、收件名單快照、失敗名單、建立跟進信 |
| `src/app/api/cron/broadcast/route.ts` | 排程寄送入口 |
| `src/app/api/webhooks/resend/route.ts` | 成效事件與退信回寫 |
| `scripts/test-edm-delivery.ts` | mock Resend：部分成功、429 重試、5xx 用盡、跟進名單口徑 |

---

## 9. 改這個模組時最容易踩的坑

1. **`"use server"` 檔案只能 export async function**——共用常數／同步 helper 要另開檔（`audience.ts`、`followup.ts` 就是這樣來的）
2. **`audienceData` 是展開進六個 Prisma write 的**，新增欄位要確認每個寫入點都會正確重設，否則切換發送對象時會留殘值
3. **加欄位要先跑 migration 再部署**：`executeBroadcast` 等處用不帶 `select` 的 `findUnique`，Prisma 會 SELECT 所有純量欄位，欄位不存在會讓整個群發後台 500
4. 表單裡有**兩種不同的 `name="groupId"`**：發送對象用的（已改名 `groupIds`）與「把這批名單存成群組」用的（由 `resolveTargetGroup` 消費），別改錯
5. 新的名單來源請匯進 `resolveRecipients`，不要繞過去重與退訂過濾
6. 手寫 migration SQL 後要 `grep 'public\.\|auth\.'` 確認為空才能推（CLAUDE.md 鐵則）

---

## 10. 測試指令

```bash
npx tsx scripts/test-edm-render.ts
npx tsx --conditions=react-server scripts/test-edm-delivery.ts

# 會寫資料庫，只能對 localhost / 127.0.0.1 執行；腳本本身有安全鎖
npx tsx --conditions=react-server scripts/test-broadcast-notice-db.ts

pnpm check:actions
npx tsc --noEmit
pnpm lint
pnpm build
```
