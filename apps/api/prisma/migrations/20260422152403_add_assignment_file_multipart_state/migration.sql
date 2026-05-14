-- AlterEnum
ALTER TYPE "AssignmentFileStatus" ADD VALUE 'UPLOADING';

-- AlterTable
ALTER TABLE "AssignmentFile" ADD COLUMN     "uploadId" TEXT;
