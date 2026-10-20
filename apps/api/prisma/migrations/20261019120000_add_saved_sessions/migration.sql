-- CreateTable
CREATE TABLE "SavedSession" (
    "storeId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "assignmentId" INTEGER NOT NULL,
    "token" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SavedSession_pkey" PRIMARY KEY ("storeId","role","assignmentId")
);

-- CreateIndex
CREATE INDEX "SavedSession_updatedAt_idx" ON "SavedSession"("updatedAt");
