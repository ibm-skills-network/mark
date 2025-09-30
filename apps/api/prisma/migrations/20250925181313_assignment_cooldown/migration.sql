-- AlterTable
ALTER TABLE "Assignment" ADD COLUMN     "attemptsBeforeCoolDown" INTEGER DEFAULT 1,
ADD COLUMN     "retakeAttemptCoolDownMinutes" INTEGER DEFAULT 5;
