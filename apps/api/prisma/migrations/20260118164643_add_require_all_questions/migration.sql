-- AlterTable
ALTER TABLE "Assignment" ADD COLUMN     "requireAllQuestions" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "AssignmentDraft" ADD COLUMN     "requireAllQuestions" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "AssignmentVersion" ADD COLUMN     "requireAllQuestions" BOOLEAN NOT NULL DEFAULT false;
