-- CreateTable
CREATE TABLE "AssignmentAuthor" (
    "id" SERIAL NOT NULL,
    "assignmentId" INTEGER NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AssignmentAuthor_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AssignmentAuthor_assignmentId_idx" ON "AssignmentAuthor"("assignmentId");

-- CreateIndex
CREATE INDEX "AssignmentAuthor_userId_idx" ON "AssignmentAuthor"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "AssignmentAuthor_assignmentId_userId_key" ON "AssignmentAuthor"("assignmentId", "userId");

-- AddForeignKey
ALTER TABLE "AssignmentAuthor" ADD CONSTRAINT "AssignmentAuthor_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "Assignment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
