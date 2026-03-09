-- AlterTable
ALTER TABLE "Report" ADD COLUMN     "renewalAction" TEXT,
ADD COLUMN     "renewalActionAt" TIMESTAMP(3),
ADD COLUMN     "renewalCloseTokenHash" TEXT,
ADD COLUMN     "renewalEmailSentAt" TIMESTAMP(3),
ADD COLUMN     "renewalRenewTokenHash" TEXT,
ADD COLUMN     "renewalTokenExpiresAt" TIMESTAMP(3);
