ALTER TABLE "course"."CourseMaterial" ADD COLUMN "storagePath" TEXT;
ALTER TABLE "course"."CourseMaterial" ALTER COLUMN "url" DROP NOT NULL;
