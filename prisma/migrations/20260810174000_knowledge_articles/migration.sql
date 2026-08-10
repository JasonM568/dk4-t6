CREATE TABLE "KnowledgeArticle" (
  "id" TEXT NOT NULL,
  "slug" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "summary" TEXT NOT NULL,
  "coverImage" TEXT,
  "content" TEXT NOT NULL,
  "images" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "visibility" TEXT NOT NULL DEFAULT 'PUBLIC',
  "status" TEXT NOT NULL DEFAULT 'DRAFT',
  "publishedAt" TIMESTAMP(3),
  "unpublishAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "KnowledgeArticle_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "KnowledgeArticle_slug_key" ON "KnowledgeArticle"("slug");
CREATE INDEX "KnowledgeArticle_status_publishedAt_idx" ON "KnowledgeArticle"("status", "publishedAt");
CREATE INDEX "KnowledgeArticle_visibility_status_idx" ON "KnowledgeArticle"("visibility", "status");
