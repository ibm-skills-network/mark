-- CreateEnum
CREATE TYPE "VariantType" AS ENUM ('REWORDED', 'RANDOMIZED', 'DIFFICULTY_ADJUSTED');

-- AlterTable
ALTER TABLE "Assignment" ADD COLUMN     "questionVariationNumber" INTEGER;

-- CreateTable
CREATE TABLE "AssignmentAttemptQuestionVariant" (
    "assignmentAttemptId" INTEGER NOT NULL,
    "questionId" INTEGER NOT NULL,
    "questionVariantId" INTEGER NOT NULL,

    CONSTRAINT "AssignmentAttemptQuestionVariant_pkey" PRIMARY KEY ("assignmentAttemptId","questionId")
);

-- CreateTable
CREATE TABLE "QuestionVariant" (
    "id" SERIAL NOT NULL,
    "questionId" INTEGER NOT NULL,
    "variantContent" TEXT NOT NULL,
    "choices" JSONB,
    "maxWords" INTEGER,
    "scoring" JSONB,
    "answer" BOOLEAN,
    "maxCharacters" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "difficultyLevel" INTEGER,
    "variantType" "VariantType" NOT NULL,

    CONSTRAINT "QuestionVariant_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "QuestionVariant_questionId_variantContent_key" ON "QuestionVariant"("questionId", "variantContent");

-- AddForeignKey
ALTER TABLE "AssignmentAttemptQuestionVariant" ADD CONSTRAINT "AssignmentAttemptQuestionVariant_assignmentAttemptId_fkey" FOREIGN KEY ("assignmentAttemptId") REFERENCES "AssignmentAttempt"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssignmentAttemptQuestionVariant" ADD CONSTRAINT "AssignmentAttemptQuestionVariant_questionVariantId_fkey" FOREIGN KEY ("questionVariantId") REFERENCES "QuestionVariant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssignmentAttemptQuestionVariant" ADD CONSTRAINT "AssignmentAttemptQuestionVariant_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "Question"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuestionVariant" ADD CONSTRAINT "QuestionVariant_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "Question"("id") ON DELETE CASCADE ON UPDATE CASCADE;
