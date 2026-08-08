-- 同意欄位改 nullable：1shop 訂單回填手機時「不能」代替會員按同意——
-- 同意紀錄必須來自會員本人的動作（個資法舉證鏈）。回填列 phone 有值、同意欄位為 null，
-- 登入閘門改為「有手機且有同意」才放行，回填會員登入時手機已預填、勾同意即完成。
-- 既有資料不受影響（原本就都有值）。
ALTER TABLE "MemberProfile" ALTER COLUMN "privacyConsentAt" DROP NOT NULL;
ALTER TABLE "MemberProfile" ALTER COLUMN "privacyConsentVersion" DROP NOT NULL;
