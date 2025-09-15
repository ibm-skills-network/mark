-- CreateTable
CREATE TABLE "Job" (
    "id" SERIAL NOT NULL,
    "userId" TEXT NOT NULL,
    "assignmentId" INTEGER NOT NULL,
    "status" TEXT NOT NULL,
    "progress" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "result" JSONB,

    CONSTRAINT "Job_pkey" PRIMARY KEY ("id")
);
