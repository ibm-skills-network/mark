/*
  Warnings:

  - You are about to drop the `AuthorUpload` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `LearnerFileUpload` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `ReportFile` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "LearnerFileUpload" DROP CONSTRAINT "LearnerFileUpload_assignmentId_fkey";

-- DropForeignKey
ALTER TABLE "LearnerFileUpload" DROP CONSTRAINT "LearnerFileUpload_attemptId_fkey";

-- DropForeignKey
ALTER TABLE "LearnerFileUpload" DROP CONSTRAINT "LearnerFileUpload_questionId_fkey";

-- DropForeignKey
ALTER TABLE "ReportFile" DROP CONSTRAINT "ReportFile_reportId_fkey";

-- DropTable
DROP TABLE "AuthorUpload";

-- DropTable
DROP TABLE "LearnerFileUpload";

-- DropTable
DROP TABLE "ReportFile";
