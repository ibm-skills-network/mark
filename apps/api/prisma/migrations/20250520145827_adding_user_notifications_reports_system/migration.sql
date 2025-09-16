-- DropForeignKey
ALTER TABLE "Report" DROP CONSTRAINT "Report_assignmentId_fkey";

-- AlterTable
ALTER TABLE "Report" ADD COLUMN     "closureReason" TEXT,
ADD COLUMN     "comments" TEXT,
ADD COLUMN     "duplicateOfReportId" INTEGER,
ADD COLUMN     "issueNumber" INTEGER,
ADD COLUMN     "relatedToReportId" INTEGER,
ADD COLUMN     "resolution" TEXT,
ADD COLUMN     "similarityScore" DOUBLE PRECISION,
ADD COLUMN     "status" "ReportStatus" NOT NULL DEFAULT 'OPEN',
ADD COLUMN     "statusMessage" TEXT,
ALTER COLUMN "assignmentId" DROP NOT NULL;

-- CreateTable
CREATE TABLE "UserNotification" (
    "id" SERIAL NOT NULL,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "metadata" TEXT,
    "read" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserNotification_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "Report" ADD CONSTRAINT "Report_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "Assignment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Report" ADD CONSTRAINT "Report_duplicateOfReportId_fkey" FOREIGN KEY ("duplicateOfReportId") REFERENCES "Report"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Report" ADD CONSTRAINT "Report_relatedToReportId_fkey" FOREIGN KEY ("relatedToReportId") REFERENCES "Report"("id") ON DELETE SET NULL ON UPDATE CASCADE;
