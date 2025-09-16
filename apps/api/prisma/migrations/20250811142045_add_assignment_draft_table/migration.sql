-- CreateTable
CREATE TABLE "AssignmentDraft" (
    "id" SERIAL NOT NULL,
    "assignmentId" INTEGER NOT NULL,
    "userId" TEXT NOT NULL,
    "draftName" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "introduction" TEXT,
    "instructions" TEXT,
    "gradingCriteriaOverview" TEXT,
    "timeEstimateMinutes" INTEGER,
    "type" "AssignmentType" NOT NULL,
    "graded" BOOLEAN DEFAULT false,
    "numAttempts" INTEGER DEFAULT -1,
    "allotedTimeMinutes" INTEGER,
    "attemptsPerTimeRange" INTEGER,
    "attemptsTimeRangeHours" INTEGER,
    "passingGrade" INTEGER DEFAULT 50,
    "displayOrder" "AssignmentQuestionDisplayOrder",
    "questionDisplay" "QuestionDisplay" DEFAULT 'ONE_PER_PAGE',
    "numberOfQuestionsPerAttempt" INTEGER,
    "questionOrder" INTEGER[],
    "published" BOOLEAN NOT NULL DEFAULT false,
    "showAssignmentScore" BOOLEAN NOT NULL DEFAULT true,
    "showQuestionScore" BOOLEAN NOT NULL DEFAULT true,
    "showSubmissionFeedback" BOOLEAN NOT NULL DEFAULT true,
    "showQuestions" BOOLEAN NOT NULL DEFAULT true,
    "languageCode" TEXT,
    "questionsData" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AssignmentDraft_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AssignmentDraft_assignmentId_idx" ON "AssignmentDraft"("assignmentId");

-- CreateIndex
CREATE INDEX "AssignmentDraft_userId_idx" ON "AssignmentDraft"("userId");

-- CreateIndex
CREATE INDEX "AssignmentDraft_createdAt_idx" ON "AssignmentDraft"("createdAt");

-- AddForeignKey
ALTER TABLE "AssignmentDraft" ADD CONSTRAINT "AssignmentDraft_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "Assignment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
