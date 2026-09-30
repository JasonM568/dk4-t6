-- EDM 課前通知的名單範圍：ALL＝全部報名者；PENDING＝只寄 SessionSignup.emailNoticeAt 為空的人。
-- 與 SmsBroadcast.noticeScope 同義——簡訊那邊 2026-09 已上線「只發還沒收到的人」，
-- Email 一直缺這一半：開課前重複匯入名單後，只想通知這次新進來的人卻只能整批重寄。
-- 純新增欄位、預設 ALL，既有群發紀錄行為不變。限於 course schema；不觸碰 public / auth。
ALTER TABLE "course"."EmailBroadcast"
  ADD COLUMN "noticeScope" TEXT NOT NULL DEFAULT 'ALL';
