-- CreateEnum
CREATE TYPE "AssignmentType" AS ENUM ('AI_GRADED', 'MANUAL');

-- CreateEnum
CREATE TYPE "AssignmentQuestionDisplayOrder" AS ENUM ('DEFINED', 'RANDOM');

-- CreateEnum
CREATE TYPE "QuestionType" AS ENUM ('TEXT', 'SINGLE_CORRECT', 'MULTIPLE_CORRECT', 'TRUE_FALSE', 'URL', 'UPLOAD');

-- CreateEnum
CREATE TYPE "ScoringType" AS ENUM ('CRITERIA_BASED', 'LOSS_PER_MISTAKE', 'AI_GRADED');

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
    "type" "AssignmentType" NOT NULL,
    "graded" BOOLEAN,
    "numAttempts" INTEGER,
    "allotedTimeMinutes" INTEGER,
    "attemptsPerTimeRange" INTEGER,
    "attemptsTimeRangeHours" INTEGER,
    "passingGrade" INTEGER,
    "displayOrder" "AssignmentQuestionDisplayOrder",
    "questionOrder" INTEGER[],
    "published" BOOLEAN NOT NULL,

    CONSTRAINT "Assignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Question" (
    "id" SERIAL NOT NULL,
    "totalPoints" INTEGER NOT NULL,
    "numRetries" INTEGER,
    "type" "QuestionType" NOT NULL,
    "question" TEXT NOT NULL,
    "maxWords" INTEGER,
    "scoring" JSONB,
    "choices" JSONB,
    "answer" BOOLEAN,
    "assignmentId" INTEGER NOT NULL,
    "gradingContextQuestionIds" INTEGER[],

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

    CONSTRAINT "AssignmentAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QuestionResponse" (
    "id" SERIAL NOT NULL,
    "assignmentAttemptId" INTEGER NOT NULL,
    "questionId" INTEGER NOT NULL,
    "learnerResponse" TEXT NOT NULL,
    "points" INTEGER NOT NULL,
    "feedback" JSONB NOT NULL,

    CONSTRAINT "QuestionResponse_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Group_id_key" ON "Group"("id");

-- AddForeignKey
ALTER TABLE "AssignmentGroup" ADD CONSTRAINT "AssignmentGroup_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "Assignment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssignmentGroup" ADD CONSTRAINT "AssignmentGroup_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "Group"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Question" ADD CONSTRAINT "Question_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "Assignment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuestionResponse" ADD CONSTRAINT "QuestionResponse_assignmentAttemptId_fkey" FOREIGN KEY ("assignmentAttemptId") REFERENCES "AssignmentAttempt"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
