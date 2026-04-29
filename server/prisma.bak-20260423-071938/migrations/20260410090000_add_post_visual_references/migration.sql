-- CreateTable
CREATE TABLE "PostVisualReference" (
    "id" TEXT NOT NULL,
    "postId" TEXT NOT NULL,
    "thumbnailUrl" TEXT NOT NULL,
    "sourceUrl" TEXT NOT NULL,
    "sourceDomain" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL DEFAULT 'web',
    "title" TEXT,
    "description" TEXT,
    "pinId" TEXT,
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PostVisualReference_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PostVisualReference_postId_idx" ON "PostVisualReference"("postId");

-- CreateIndex
CREATE INDEX "PostVisualReference_sourceDomain_idx" ON "PostVisualReference"("sourceDomain");

-- AddForeignKey
ALTER TABLE "PostVisualReference" ADD CONSTRAINT "PostVisualReference_postId_fkey" FOREIGN KEY ("postId") REFERENCES "CalendarPost"("id") ON DELETE CASCADE ON UPDATE CASCADE;
