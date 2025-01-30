-- DropForeignKey
ALTER TABLE "AssignmentAttemptQuestionVariant" DROP CONSTRAINT "AssignmentAttemptQuestionVariant_questionVariantId_fkey";

-- AlterTable
ALTER TABLE "AssignmentAttemptQuestionVariant" ALTER COLUMN "questionVariantId" DROP NOT NULL;

-- AddForeignKey
ALTER TABLE "AssignmentAttemptQuestionVariant" ADD CONSTRAINT "AssignmentAttemptQuestionVariant_questionVariantId_fkey" FOREIGN KEY ("questionVariantId") REFERENCES "QuestionVariant"("id") ON DELETE SET NULL ON UPDATE CASCADE;
