-- CreateTable
CREATE TABLE "ReportDiagnostics" (
    "id" SERIAL NOT NULL,
    "reportId" INTEGER NOT NULL,
    "data" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReportDiagnostics_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ReportDiagnostics_reportId_key" ON "ReportDiagnostics"("reportId");

-- AddForeignKey
ALTER TABLE "ReportDiagnostics" ADD CONSTRAINT "ReportDiagnostics_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "Report"("id") ON DELETE CASCADE ON UPDATE CASCADE;
