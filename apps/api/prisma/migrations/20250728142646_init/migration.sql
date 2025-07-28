-- CreateEnum
CREATE TYPE "AssignmentType" AS ENUM ('AI_GRADED', 'MANUAL');

-- CreateEnum
CREATE TYPE "AssignmentQuestionDisplayOrder" AS ENUM ('DEFINED', 'RANDOM');

-- CreateEnum
CREATE TYPE "QuestionType" AS ENUM ('TEXT', 'SINGLE_CORRECT', 'MULTIPLE_CORRECT', 'TRUE_FALSE', 'URL', 'UPLOAD', 'LINK_FILE');

-- CreateEnum
CREATE TYPE "ResponseType" AS ENUM ('REPO', 'CODE', 'ESSAY', 'REPORT', 'PRESENTATION', 'VIDEO', 'AUDIO', 'IMAGES', 'SPREADSHEET', 'LIVE_RECORDING', 'OTHER');

-- CreateEnum
CREATE TYPE "QuestionDisplay" AS ENUM ('ONE_PER_PAGE', 'ALL_PER_PAGE');

-- CreateEnum
CREATE TYPE "ScoringType" AS ENUM ('CRITERIA_BASED', 'LOSS_PER_MISTAKE', 'AI_GRADED');

-- CreateEnum
CREATE TYPE "AIUsageType" AS ENUM ('QUESTION_GENERATION', 'ASSIGNMENT_GENERATION', 'ASSIGNMENT_GRADING', 'TRANSLATION', 'LIVE_RECORDING_FEEDBACK');

-- CreateEnum
CREATE TYPE "ChatRole" AS ENUM ('USER', 'ASSISTANT', 'SYSTEM');

-- CreateEnum
CREATE TYPE "VariantType" AS ENUM ('REWORDED', 'RANDOMIZED', 'DIFFICULTY_ADJUSTED');

-- CreateEnum
CREATE TYPE "RegradingStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'COMPLETED');

-- CreateEnum
CREATE TYPE "ReportType" AS ENUM ('BUG', 'FEEDBACK', 'SUGGESTION', 'PERFORMANCE', 'FALSE_MARKING', 'OTHER');

-- CreateEnum
CREATE TYPE "ReportStatus" AS ENUM ('OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED');

-- CreateEnum
CREATE TYPE "AssignmentTypeEnum" AS ENUM ('Quiz', 'Assignment', 'Project', 'Midterm', 'Final', 'Exam', 'Test', 'Lab', 'Homework', 'Practice', 'Assessment', 'Survey', 'Evaluation', 'Review', 'Reflection');

-- CreateTable
CREATE TABLE "GradingAudit" (
    "id" SERIAL NOT NULL,
    "questionId" INTEGER NOT NULL,
    "assignmentId" INTEGER,
    "requestPayload" TEXT NOT NULL,
    "responsePayload" TEXT NOT NULL,
    "gradingStrategy" TEXT NOT NULL,
    "metadata" TEXT,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GradingAudit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Job" (
    "id" SERIAL NOT NULL,
    "userId" TEXT NOT NULL,
    "assignmentId" INTEGER NOT NULL,
    "status" TEXT NOT NULL,
    "progress" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "result" JSONB,

    CONSTRAINT "Job_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GradingJob" (
    "id" SERIAL NOT NULL,
    "attemptId" INTEGER,
    "assignmentId" INTEGER NOT NULL,
    "userId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "progress" TEXT NOT NULL,
    "percentage" INTEGER,
    "result" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GradingJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "publishJob" (
    "id" SERIAL NOT NULL,
    "userId" TEXT NOT NULL,
    "assignmentId" INTEGER NOT NULL,
    "status" TEXT NOT NULL,
    "progress" TEXT,
    "percentage" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "result" JSONB,

    CONSTRAINT "publishJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AIUsage" (
    "id" SERIAL NOT NULL,
    "assignmentId" INTEGER NOT NULL,
    "usageType" "AIUsageType" NOT NULL,
    "tokensIn" INTEGER NOT NULL DEFAULT 0,
    "tokensOut" INTEGER NOT NULL DEFAULT 0,
    "usageCount" INTEGER NOT NULL DEFAULT 0,
    "usageDetails" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "userId" TEXT,

    CONSTRAINT "AIUsage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserCredential" (
    "userId" TEXT NOT NULL,
    "githubToken" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserCredential_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE "Chat" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastActiveAt" TIMESTAMP(3) NOT NULL,
    "title" TEXT,
    "assignmentId" INTEGER,
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "Chat_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChatMessage" (
    "id" SERIAL NOT NULL,
    "chatId" TEXT NOT NULL,
    "role" "ChatRole" NOT NULL,
    "content" TEXT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "toolCalls" JSONB,

    CONSTRAINT "ChatMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Group" (
    "id" TEXT NOT NULL
);

-- CreateTable
CREATE TABLE "AssignmentGroup" (
    "assignmentId" INTEGER NOT NULL,
    "groupId" TEXT NOT NULL,

    CONSTRAINT "AssignmentGroup_pkey" PRIMARY KEY ("assignmentId","groupId")
);

-- CreateTable
CREATE TABLE "Assignment" (
    "id" SERIAL NOT NULL,
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
    "published" BOOLEAN NOT NULL,
    "showAssignmentScore" BOOLEAN NOT NULL DEFAULT true,
    "showQuestionScore" BOOLEAN NOT NULL DEFAULT true,
    "showSubmissionFeedback" BOOLEAN NOT NULL DEFAULT true,
    "showQuestions" BOOLEAN NOT NULL DEFAULT true,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "languageCode" TEXT,

    CONSTRAINT "Assignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Question" (
    "id" SERIAL NOT NULL,
    "totalPoints" INTEGER NOT NULL,
    "type" "QuestionType" NOT NULL,
    "responseType" "ResponseType",
    "question" TEXT NOT NULL,
    "maxWords" INTEGER,
    "scoring" JSONB,
    "choices" JSONB,
    "randomizedChoices" BOOLEAN,
    "answer" BOOLEAN,
    "assignmentId" INTEGER NOT NULL,
    "gradingContextQuestionIds" INTEGER[],
    "maxCharacters" INTEGER,
    "isDeleted" BOOLEAN NOT NULL DEFAULT false,
    "videoPresentationConfig" JSONB,
    "liveRecordingConfig" JSONB,

    CONSTRAINT "Question_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AssignmentAttempt" (
    "id" SERIAL NOT NULL,
    "assignmentId" INTEGER NOT NULL,
    "userId" TEXT NOT NULL,
    "submitted" BOOLEAN NOT NULL,
    "grade" DOUBLE PRECISION,
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "questionOrder" INTEGER[],
    "comments" TEXT,
    "preferredLanguage" TEXT,

    CONSTRAINT "AssignmentAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AssignmentAttemptQuestionVariant" (
    "assignmentAttemptId" INTEGER NOT NULL,
    "questionId" INTEGER NOT NULL,
    "questionVariantId" INTEGER,
    "randomizedChoices" JSONB,

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
    "randomizedChoices" BOOLEAN,
    "isDeleted" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "QuestionVariant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QuestionResponse" (
    "id" SERIAL NOT NULL,
    "assignmentAttemptId" INTEGER NOT NULL,
    "questionId" INTEGER NOT NULL,
    "learnerResponse" TEXT NOT NULL,
    "points" DOUBLE PRECISION NOT NULL,
    "feedback" JSONB NOT NULL,
    "metadata" JSONB,
    "gradedAt" TIMESTAMP(3),

    CONSTRAINT "QuestionResponse_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AssignmentFeedback" (
    "id" SERIAL NOT NULL,
    "assignmentId" INTEGER NOT NULL,
    "attemptId" INTEGER NOT NULL,
    "userId" TEXT NOT NULL,
    "comments" TEXT,
    "aiGradingRating" INTEGER,
    "assignmentRating" INTEGER,
    "aiFeedbackRating" INTEGER,
    "allowContact" BOOLEAN NOT NULL DEFAULT false,
    "firstName" TEXT,
    "lastName" TEXT,
    "email" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AssignmentFeedback_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RegradingRequest" (
    "id" SERIAL NOT NULL,
    "assignmentId" INTEGER NOT NULL,
    "userId" TEXT NOT NULL,
    "attemptId" INTEGER NOT NULL,
    "regradingReason" TEXT,
    "regradingStatus" "RegradingStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RegradingRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Report" (
    "id" SERIAL NOT NULL,
    "reporterId" TEXT NOT NULL,
    "assignmentId" INTEGER,
    "attemptId" INTEGER,
    "issueType" "ReportType" NOT NULL,
    "description" TEXT NOT NULL,
    "author" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "status" "ReportStatus" NOT NULL DEFAULT 'OPEN',
    "issueNumber" INTEGER,
    "statusMessage" TEXT,
    "resolution" TEXT,
    "comments" TEXT,
    "closureReason" TEXT,
    "duplicateOfReportId" INTEGER,
    "relatedToReportId" INTEGER,
    "similarityScore" DOUBLE PRECISION,

    CONSTRAINT "Report_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserNotification" (
    "id" SERIAL NOT NULL,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "metadata" TEXT,
    "read" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserNotification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Translation" (
    "id" SERIAL NOT NULL,
    "questionId" INTEGER,
    "variantId" INTEGER,
    "languageCode" TEXT NOT NULL,
    "translatedText" TEXT NOT NULL,
    "untranslatedText" TEXT,
    "translatedChoices" JSONB,
    "untranslatedChoices" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Translation_pkey" PRIMARY KEY ("id")
);

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

-- CreateTable
CREATE TABLE "_ChatToUserCredential" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL
);

-- CreateIndex
CREATE INDEX "GradingAudit_questionId_idx" ON "GradingAudit"("questionId");

-- CreateIndex
CREATE INDEX "GradingAudit_assignmentId_idx" ON "GradingAudit"("assignmentId");

-- CreateIndex
CREATE INDEX "GradingAudit_timestamp_idx" ON "GradingAudit"("timestamp");

-- CreateIndex
CREATE INDEX "GradingJob_attemptId_idx" ON "GradingJob"("attemptId");

-- CreateIndex
CREATE INDEX "GradingJob_assignmentId_idx" ON "GradingJob"("assignmentId");

-- CreateIndex
CREATE INDEX "GradingJob_userId_idx" ON "GradingJob"("userId");

-- CreateIndex
CREATE INDEX "GradingJob_status_idx" ON "GradingJob"("status");

-- CreateIndex
CREATE UNIQUE INDEX "AIUsage_assignmentId_usageType_key" ON "AIUsage"("assignmentId", "usageType");

-- CreateIndex
CREATE INDEX "Chat_userId_startedAt_idx" ON "Chat"("userId", "startedAt");

-- CreateIndex
CREATE INDEX "Chat_assignmentId_idx" ON "Chat"("assignmentId");

-- CreateIndex
CREATE INDEX "ChatMessage_chatId_timestamp_idx" ON "ChatMessage"("chatId", "timestamp");

-- CreateIndex
CREATE UNIQUE INDEX "Group_id_key" ON "Group"("id");

-- CreateIndex
CREATE UNIQUE INDEX "QuestionVariant_questionId_variantContent_key" ON "QuestionVariant"("questionId", "variantContent");

-- CreateIndex
CREATE INDEX "Translation_questionId_variantId_languageCode_idx" ON "Translation"("questionId", "variantId", "languageCode");

-- CreateIndex
CREATE UNIQUE INDEX "AssignmentTranslation_assignmentId_languageCode_key" ON "AssignmentTranslation"("assignmentId", "languageCode");

-- CreateIndex
CREATE UNIQUE INDEX "FeedbackTranslation_questionId_languageCode_key" ON "FeedbackTranslation"("questionId", "languageCode");

-- CreateIndex
CREATE UNIQUE INDEX "_ChatToUserCredential_AB_unique" ON "_ChatToUserCredential"("A", "B");

-- CreateIndex
CREATE INDEX "_ChatToUserCredential_B_index" ON "_ChatToUserCredential"("B");

-- AddForeignKey
ALTER TABLE "GradingAudit" ADD CONSTRAINT "GradingAudit_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "Question"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GradingAudit" ADD CONSTRAINT "GradingAudit_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "Assignment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GradingJob" ADD CONSTRAINT "GradingJob_attemptId_fkey" FOREIGN KEY ("attemptId") REFERENCES "AssignmentAttempt"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GradingJob" ADD CONSTRAINT "GradingJob_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "Assignment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AIUsage" ADD CONSTRAINT "AIUsage_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "Assignment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AIUsage" ADD CONSTRAINT "AIUsage_userId_fkey" FOREIGN KEY ("userId") REFERENCES "UserCredential"("userId") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Chat" ADD CONSTRAINT "Chat_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "Assignment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChatMessage" ADD CONSTRAINT "ChatMessage_chatId_fkey" FOREIGN KEY ("chatId") REFERENCES "Chat"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssignmentGroup" ADD CONSTRAINT "AssignmentGroup_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "Assignment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssignmentGroup" ADD CONSTRAINT "AssignmentGroup_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "Group"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Question" ADD CONSTRAINT "Question_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "Assignment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssignmentAttemptQuestionVariant" ADD CONSTRAINT "AssignmentAttemptQuestionVariant_assignmentAttemptId_fkey" FOREIGN KEY ("assignmentAttemptId") REFERENCES "AssignmentAttempt"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssignmentAttemptQuestionVariant" ADD CONSTRAINT "AssignmentAttemptQuestionVariant_questionVariantId_fkey" FOREIGN KEY ("questionVariantId") REFERENCES "QuestionVariant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssignmentAttemptQuestionVariant" ADD CONSTRAINT "AssignmentAttemptQuestionVariant_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "Question"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuestionVariant" ADD CONSTRAINT "QuestionVariant_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "Question"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuestionResponse" ADD CONSTRAINT "QuestionResponse_assignmentAttemptId_fkey" FOREIGN KEY ("assignmentAttemptId") REFERENCES "AssignmentAttempt"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssignmentFeedback" ADD CONSTRAINT "AssignmentFeedback_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "Assignment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssignmentFeedback" ADD CONSTRAINT "AssignmentFeedback_attemptId_fkey" FOREIGN KEY ("attemptId") REFERENCES "AssignmentAttempt"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RegradingRequest" ADD CONSTRAINT "RegradingRequest_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "Assignment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RegradingRequest" ADD CONSTRAINT "RegradingRequest_attemptId_fkey" FOREIGN KEY ("attemptId") REFERENCES "AssignmentAttempt"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Report" ADD CONSTRAINT "Report_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "Assignment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Report" ADD CONSTRAINT "Report_duplicateOfReportId_fkey" FOREIGN KEY ("duplicateOfReportId") REFERENCES "Report"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Report" ADD CONSTRAINT "Report_relatedToReportId_fkey" FOREIGN KEY ("relatedToReportId") REFERENCES "Report"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Translation" ADD CONSTRAINT "Translation_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "Question"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Translation" ADD CONSTRAINT "Translation_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "QuestionVariant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssignmentTranslation" ADD CONSTRAINT "AssignmentTranslation_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "Assignment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FeedbackTranslation" ADD CONSTRAINT "FeedbackTranslation_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "Question"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_ChatToUserCredential" ADD CONSTRAINT "_ChatToUserCredential_A_fkey" FOREIGN KEY ("A") REFERENCES "Chat"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_ChatToUserCredential" ADD CONSTRAINT "_ChatToUserCredential_B_fkey" FOREIGN KEY ("B") REFERENCES "UserCredential"("userId") ON DELETE CASCADE ON UPDATE CASCADE;
