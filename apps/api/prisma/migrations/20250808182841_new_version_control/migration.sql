-- AlterTable
ALTER TABLE "Assignment" ADD COLUMN     "currentVersionId" INTEGER;

-- CreateTable
CREATE TABLE "AssignmentVersion" (
    "id" SERIAL NOT NULL,
    "assignmentId" INTEGER NOT NULL,
    "versionNumber" INTEGER NOT NULL,
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
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "isDraft" BOOLEAN NOT NULL DEFAULT true,
    "versionDescription" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "AssignmentVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QuestionVersion" (
    "id" SERIAL NOT NULL,
    "assignmentVersionId" INTEGER NOT NULL,
    "questionId" INTEGER,
    "totalPoints" INTEGER NOT NULL,
    "type" "QuestionType" NOT NULL,
    "responseType" "ResponseType",
    "question" TEXT NOT NULL,
    "maxWords" INTEGER,
    "scoring" JSONB,
    "choices" JSONB,
    "randomizedChoices" BOOLEAN,
    "answer" BOOLEAN,
    "gradingContextQuestionIds" INTEGER[],
    "maxCharacters" INTEGER,
    "videoPresentationConfig" JSONB,
    "liveRecordingConfig" JSONB,
    "displayOrder" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "QuestionVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VersionHistory" (
    "id" SERIAL NOT NULL,
    "assignmentId" INTEGER NOT NULL,
    "fromVersionId" INTEGER,
    "toVersionId" INTEGER NOT NULL,
    "action" TEXT NOT NULL,
    "description" TEXT,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "metadata" JSONB,

    CONSTRAINT "VersionHistory_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AssignmentVersion_assignmentId_idx" ON "AssignmentVersion"("assignmentId");

-- CreateIndex
CREATE INDEX "AssignmentVersion_isActive_idx" ON "AssignmentVersion"("isActive");

-- CreateIndex
CREATE INDEX "AssignmentVersion_isDraft_idx" ON "AssignmentVersion"("isDraft");

-- CreateIndex
CREATE UNIQUE INDEX "AssignmentVersion_assignmentId_versionNumber_key" ON "AssignmentVersion"("assignmentId", "versionNumber");

-- CreateIndex
CREATE INDEX "QuestionVersion_assignmentVersionId_idx" ON "QuestionVersion"("assignmentVersionId");

-- CreateIndex
CREATE INDEX "QuestionVersion_questionId_idx" ON "QuestionVersion"("questionId");

-- CreateIndex
CREATE INDEX "VersionHistory_assignmentId_idx" ON "VersionHistory"("assignmentId");

-- CreateIndex
CREATE INDEX "VersionHistory_createdAt_idx" ON "VersionHistory"("createdAt");

-- CreateIndex
CREATE INDEX "VersionHistory_userId_idx" ON "VersionHistory"("userId");

-- AddForeignKey
ALTER TABLE "Assignment" ADD CONSTRAINT "Assignment_currentVersionId_fkey" FOREIGN KEY ("currentVersionId") REFERENCES "AssignmentVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssignmentVersion" ADD CONSTRAINT "AssignmentVersion_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "Assignment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuestionVersion" ADD CONSTRAINT "QuestionVersion_assignmentVersionId_fkey" FOREIGN KEY ("assignmentVersionId") REFERENCES "AssignmentVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VersionHistory" ADD CONSTRAINT "VersionHistory_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "Assignment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VersionHistory" ADD CONSTRAINT "VersionHistory_fromVersionId_fkey" FOREIGN KEY ("fromVersionId") REFERENCES "AssignmentVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VersionHistory" ADD CONSTRAINT "VersionHistory_toVersionId_fkey" FOREIGN KEY ("toVersionId") REFERENCES "AssignmentVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;
