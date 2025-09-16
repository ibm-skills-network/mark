-- AlterTable
ALTER TABLE "AssignmentAttempt" ADD COLUMN     "assignmentVersionId" INTEGER;

-- CreateIndex
CREATE INDEX "AssignmentAttempt_assignmentVersionId_idx" ON "AssignmentAttempt"("assignmentVersionId");

-- AddForeignKey
ALTER TABLE "AssignmentAttempt" ADD CONSTRAINT "AssignmentAttempt_assignmentVersionId_fkey" FOREIGN KEY ("assignmentVersionId") REFERENCES "AssignmentVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;
