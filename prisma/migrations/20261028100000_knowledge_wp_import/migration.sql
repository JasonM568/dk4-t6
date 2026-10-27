-- 院長乾貨區匯入：保留舊站 HTML 內文、來源網址、WordPress post id（冪等鍵）
ALTER TABLE "course"."KnowledgeArticle" ADD COLUMN "contentHtml" TEXT;
ALTER TABLE "course"."KnowledgeArticle" ADD COLUMN "sourceUrl" TEXT;
ALTER TABLE "course"."KnowledgeArticle" ADD COLUMN "wpId" INTEGER;
CREATE UNIQUE INDEX "KnowledgeArticle_wpId_key" ON "course"."KnowledgeArticle"("wpId");
