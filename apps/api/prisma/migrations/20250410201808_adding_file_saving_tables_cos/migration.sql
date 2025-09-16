-- CreateTable
CREATE TABLE "AuthorUpload" (
    "id" SERIAL NOT NULL,
    "userId" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "fileType" TEXT NOT NULL,
    "cosKey" TEXT NOT NULL,
    "cosBucket" TEXT NOT NULL,
    "fileSize" INTEGER,
    "contentType" TEXT,
    "assignmentId" INTEGER,
    "questionId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AuthorUpload_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LearnerFileUpload" (
    "id" SERIAL NOT NULL,
    "userId" TEXT NOT NULL,
    "assignmentId" INTEGER NOT NULL,
    "attemptId" INTEGER NOT NULL,
    "questionId" INTEGER NOT NULL,
    "fileName" TEXT NOT NULL,
    "fileType" TEXT NOT NULL,
    "cosKey" TEXT NOT NULL,
    "cosBucket" TEXT NOT NULL,
    "fileSize" INTEGER,
    "contentType" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LearnerFileUpload_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReportFile" (
    "id" SERIAL NOT NULL,
    "reportId" INTEGER NOT NULL,
    "userId" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "fileType" TEXT NOT NULL,
    "cosKey" TEXT NOT NULL,
    "cosBucket" TEXT NOT NULL,
    "fileSize" INTEGER,
    "contentType" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReportFile_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "LearnerFileUpload" ADD CONSTRAINT "LearnerFileUpload_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "Assignment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LearnerFileUpload" ADD CONSTRAINT "LearnerFileUpload_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "Question"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LearnerFileUpload" ADD CONSTRAINT "LearnerFileUpload_attemptId_fkey" FOREIGN KEY ("attemptId") REFERENCES "AssignmentAttempt"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReportFile" ADD CONSTRAINT "ReportFile_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "Report"("id") ON DELETE CASCADE ON UPDATE CASCADE;
