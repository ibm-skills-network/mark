/*
  Warnings:

  - A unique constraint covering the columns `[number,assignmentId]` on the table `Question` will be added. If there are existing duplicate values, this will fail.

*/
-- CreateIndex
CREATE UNIQUE INDEX "Question_number_assignmentId_key" ON "Question"("number", "assignmentId");
