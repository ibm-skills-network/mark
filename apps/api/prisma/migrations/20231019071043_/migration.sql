/*
  Warnings:

  - Added the required column `number` to the `Question` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "Question" ADD COLUMN     "number" INTEGER NOT NULL;
