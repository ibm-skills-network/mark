-- AlterTable
ALTER TABLE "Assignment" ADD COLUMN     "requireAllQuestions" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Assignment" ADD COLUMN     "optionalQuestionIds" INTEGER[] NOT NULL DEFAULT ARRAY[]::INTEGER[];

-- AlterTable
ALTER TABLE "AssignmentDraft" ADD COLUMN     "requireAllQuestions" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "AssignmentDraft" ADD COLUMN     "optionalQuestionIds" INTEGER[] NOT NULL DEFAULT ARRAY[]::INTEGER[];

-- AlterTable
ALTER TABLE "AssignmentVersion" ADD COLUMN     "requireAllQuestions" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "AssignmentVersion" ADD COLUMN     "optionalQuestionIds" INTEGER[] NOT NULL DEFAULT ARRAY[]::INTEGER[];
