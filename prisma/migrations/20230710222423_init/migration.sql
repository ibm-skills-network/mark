-- CreateEnum
CREATE TYPE "AssignmentType" AS ENUM ('AI_GRADED');

-- CreateEnum
CREATE TYPE "AssignmentDisplayOrder" AS ENUM ('DEFINED', 'RANDOM');

-- CreateTable
CREATE TABLE "Assignment" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "type" "AssignmentType" NOT NULL,
    "numRetries" INTEGER NOT NULL,
    "numAttempts" INTEGER NOT NULL,
    "allotedTime" TEXT NOT NULL,
    "passingGrade" INTEGER NOT NULL,
    "displayOrder" "AssignmentDisplayOrder" NOT NULL,

    CONSTRAINT "Assignment_pkey" PRIMARY KEY ("id")
);
