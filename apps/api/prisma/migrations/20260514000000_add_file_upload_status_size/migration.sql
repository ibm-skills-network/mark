-- AlterTable
ALTER TABLE "FileUpload"
    ADD COLUMN "sizeBytes" BIGINT,
    ADD COLUMN "status" TEXT NOT NULL DEFAULT 'PENDING',
    ADD COLUMN "completedAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "FileUpload_status_idx" ON "FileUpload"("status");
