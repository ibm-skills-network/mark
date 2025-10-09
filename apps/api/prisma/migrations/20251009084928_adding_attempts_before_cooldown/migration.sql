-- AlterTable
ALTER TABLE "Assignment" ADD COLUMN     "attemptsBeforeCoolDown" INTEGER DEFAULT 1,
ADD COLUMN     "retakeAttemptCoolDownMinutes" INTEGER DEFAULT 5;

-- AlterTable
ALTER TABLE "AssignmentDraft" ADD COLUMN     "attemptsBeforeCoolDown" INTEGER DEFAULT 1,
ADD COLUMN     "retakeAttemptCoolDownMinutes" INTEGER DEFAULT 5;

-- AlterTable
ALTER TABLE "AssignmentVersion" ADD COLUMN     "attemptsBeforeCoolDown" INTEGER DEFAULT 1,
ADD COLUMN     "retakeAttemptCoolDownMinutes" INTEGER DEFAULT 5;
