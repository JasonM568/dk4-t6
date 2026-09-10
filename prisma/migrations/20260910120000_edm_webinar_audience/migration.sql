-- EDM 模組新增「講座索取者」名單來源（audienceType=WEBINAR），比照簡訊那邊已有的同名對象。
--
--   EmailBroadcast.webinarIds：這封信要寄給哪幾場講座的索取者（寄出當下才解析名單，
--   與 sessionIds 同一套規則——發完才索取的人下次自動涵蓋）。
--
-- 名單本身沿用 WebinarRequest，不新增表；簡訊已經在用同一份資料。
-- 刻意不加 emailNoticeAt：EDM 沒有「只發還沒收到的人」這個 scope（那是簡訊為了省錢才有的），
-- 要補寄走既有的 failedRecipients 差集，不需要逐筆已通知旗標。
--
-- 限於 course schema；不觸碰 public / auth。純新增欄位，不改動既有資料。

ALTER TABLE "course"."EmailBroadcast"
  ADD COLUMN "webinarIds" TEXT[] DEFAULT ARRAY[]::TEXT[];
