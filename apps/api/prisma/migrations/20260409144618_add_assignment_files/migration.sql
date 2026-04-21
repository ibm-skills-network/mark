-- CreateEnum
CREATE TYPE "AssignmentFileStatus" AS ENUM ('READY', 'FAILED');

-- CreateTable
CREATE TABLE "AssignmentFile" (
    "id" SERIAL NOT NULL,
    "assignmentId" INTEGER NOT NULL,
    "filename" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "storageKey" TEXT NOT NULL,
    "storageBucket" TEXT NOT NULL,
    "status" "AssignmentFileStatus" NOT NULL DEFAULT 'READY',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AssignmentFile_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AssignmentFile_assignmentId_idx" ON "AssignmentFile"("assignmentId");

-- CreateIndex
CREATE INDEX "AssignmentFile_assignmentId_status_idx" ON "AssignmentFile"("assignmentId", "status");

-- AddForeignKey
ALTER TABLE "AssignmentFile" ADD CONSTRAINT "AssignmentFile_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "Assignment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
