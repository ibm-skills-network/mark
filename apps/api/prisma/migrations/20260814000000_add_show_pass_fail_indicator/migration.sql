ALTER TABLE "Assignment" ADD COLUMN "showPassFailIndicator" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "AssignmentVersion" ADD COLUMN "showPassFailIndicator" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "AssignmentDraft" ADD COLUMN "showPassFailIndicator" BOOLEAN NOT NULL DEFAULT false;
