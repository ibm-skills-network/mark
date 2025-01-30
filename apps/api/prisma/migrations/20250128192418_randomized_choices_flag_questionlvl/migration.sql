-- AlterTable
ALTER TABLE "AssignmentAttempt" ADD COLUMN     "questionOrder" INTEGER[];

-- AlterTable
ALTER TABLE "AssignmentAttemptQuestionVariant" ADD COLUMN     "randomizedChoices" JSONB;

-- AlterTable
ALTER TABLE "Question" ADD COLUMN     "randomizedChoices" BOOLEAN;

-- AlterTable
ALTER TABLE "QuestionVariant" ADD COLUMN     "randomizedChoices" BOOLEAN;
