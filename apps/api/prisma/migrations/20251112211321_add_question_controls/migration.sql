-- AlterTable
ALTER TABLE "Assignment" ADD COLUMN "questionControls" JSONB;

-- AlterTable
ALTER TABLE "AssignmentVersion" ADD COLUMN "questionControls" JSONB;
