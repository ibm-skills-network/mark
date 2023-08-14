/*
  Warnings:

  - Added the required column `state` to the `AssignmentSubmission` table without a default value. This is not possible if the table is not empty.

*/
-- CreateEnum
CREATE TYPE "AssignmentSubmissionState" AS ENUM ('SUBMITTED', 'EXPIRED', 'IN_PROGRESS');

-- AlterTable
ALTER TABLE "AssignmentSubmission" ADD COLUMN     "state" "AssignmentSubmissionState" NOT NULL;
