-- CreateEnum
CREATE TYPE "AssignmentType" AS ENUM ('AI_GRADED', 'MANUAL');

-- CreateEnum
CREATE TYPE "AssignmentDisplayOrder" AS ENUM ('DEFINED', 'RANDOM');

-- CreateEnum
CREATE TYPE "QuestionType" AS ENUM ('TEXT', 'SINGLE_CORRECT', 'MULTIPLE_CORRECT', 'TRUE_FALSE', 'URL', 'UPLOAD');

-- CreateEnum
CREATE TYPE "ScoringType" AS ENUM ('SINGLE_CRITERIA', 'MULTIPLE_CRITERIA', 'LOSS_PER_MISTAKE', 'AI_GRADED');

-- CreateEnum
CREATE TYPE "AssignmentSubmissionState" AS ENUM ('SUBMITTED', 'EXPIRED', 'IN_PROGRESS');

-- CreateTable
CREATE TABLE "Assignment" (
    "id" SERIAL NOT NULL,
    "name" TEXT,
    "type" "AssignmentType",
    "numAttempts" INTEGER,
    "allotedTime" INTEGER,
    "passingGrade" INTEGER,
    "displayOrder" "AssignmentDisplayOrder",

    CONSTRAINT "Assignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Question" (
    "id" SERIAL NOT NULL,
    "totalPoints" INTEGER NOT NULL,
    "numRetries" INTEGER NOT NULL,
    "type" "QuestionType" NOT NULL,
    "question" TEXT NOT NULL,
    "scoring" JSONB,
    "choices" JSONB,
    "answer" BOOLEAN,
    "assignmentId" INTEGER NOT NULL,

    CONSTRAINT "Question_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AssignmentSubmission" (
    "id" SERIAL NOT NULL,
    "assignmentId" INTEGER NOT NULL,
    "state" "AssignmentSubmissionState" NOT NULL,

    CONSTRAINT "AssignmentSubmission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QuestionResponse" (
    "id" SERIAL NOT NULL,
    "assignmentSubmissionId" INTEGER NOT NULL,
    "questionId" INTEGER NOT NULL,
    "learnerResponse" TEXT NOT NULL,
    "points" INTEGER NOT NULL,
    "feedback" JSONB NOT NULL,

    CONSTRAINT "QuestionResponse_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "Question" ADD CONSTRAINT "Question_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "Assignment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuestionResponse" ADD CONSTRAINT "QuestionResponse_assignmentSubmissionId_fkey" FOREIGN KEY ("assignmentSubmissionId") REFERENCES "AssignmentSubmission"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
