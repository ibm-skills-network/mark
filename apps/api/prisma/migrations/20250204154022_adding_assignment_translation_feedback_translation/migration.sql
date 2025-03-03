-- AlterTable
ALTER TABLE "Assignment" ADD COLUMN     "languageCode" TEXT;

-- AlterTable
ALTER TABLE "AssignmentAttempt" ADD COLUMN     "preferredLanguage" TEXT;

-- CreateTable
CREATE TABLE "AssignmentTranslation" (
    "id" SERIAL NOT NULL,
    "assignmentId" INTEGER NOT NULL,
    "languageCode" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "introduction" TEXT NOT NULL,
    "instructions" TEXT,
    "gradingCriteriaOverview" TEXT,
    "translatedName" TEXT,
    "translatedIntroduction" TEXT,
    "translatedInstructions" TEXT,
    "translatedGradingCriteriaOverview" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AssignmentTranslation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FeedbackTranslation" (
    "id" SERIAL NOT NULL,
    "questionId" INTEGER NOT NULL,
    "languageCode" TEXT NOT NULL,
    "untranslatedFeedback" JSONB NOT NULL,
    "translatedFeedback" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FeedbackTranslation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AssignmentTranslation_assignmentId_languageCode_key" ON "AssignmentTranslation"("assignmentId", "languageCode");

-- CreateIndex
CREATE UNIQUE INDEX "FeedbackTranslation_questionId_languageCode_key" ON "FeedbackTranslation"("questionId", "languageCode");

-- AddForeignKey
ALTER TABLE "AssignmentTranslation" ADD CONSTRAINT "AssignmentTranslation_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "Assignment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FeedbackTranslation" ADD CONSTRAINT "FeedbackTranslation_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "Question"("id") ON DELETE CASCADE ON UPDATE CASCADE;
