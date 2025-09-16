-- AlterTable
ALTER TABLE "AssignmentFeedback" ADD COLUMN     "allowContact" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "email" TEXT,
ADD COLUMN     "firstName" TEXT,
ADD COLUMN     "lastName" TEXT;
