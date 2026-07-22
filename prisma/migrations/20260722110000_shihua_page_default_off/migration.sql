-- 世華會專區分頁預設關閉：避免 deploy 當下 navbar 出現入口但專區尚未建立（點入 404）。
-- 後台建好專區與名單後，到「分頁管理」手動開啟。
INSERT INTO "SiteSetting" ("key", "value", "updatedAt")
VALUES ('page:shihua', 'off', now())
ON CONFLICT ("key") DO NOTHING;
