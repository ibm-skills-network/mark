-- AlterTable
ALTER TABLE "QuestionResponse" ADD COLUMN     "gradedAt" TIMESTAMP(3),
ADD COLUMN     "metadata" JSONB;
