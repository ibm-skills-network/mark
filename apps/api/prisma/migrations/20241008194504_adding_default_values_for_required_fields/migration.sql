-- AlterTable
ALTER TABLE "Assignment" ALTER COLUMN "graded" SET DEFAULT false,
ALTER COLUMN "numAttempts" SET DEFAULT -1,
ALTER COLUMN "passingGrade" SET DEFAULT 50,
ALTER COLUMN "showSubmissionFeedback" SET DEFAULT true,
ALTER COLUMN "showAssignmentScore" SET DEFAULT true,
ALTER COLUMN "showQuestionScore" SET DEFAULT true;
