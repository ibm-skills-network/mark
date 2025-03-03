/*
  Warnings:

  - A unique constraint covering the columns `[variantId,languageCode]` on the table `Translation` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "Translation" ADD COLUMN     "variantId" INTEGER,
ALTER COLUMN "questionId" DROP NOT NULL,
ALTER COLUMN "untranslatedText" DROP NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "unique_variant_lang" ON "Translation"("variantId", "languageCode");

-- AddForeignKey
ALTER TABLE "Translation" ADD CONSTRAINT "Translation_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "QuestionVariant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- RenameIndex
ALTER INDEX "Translation_questionId_languageCode_key" RENAME TO "unique_question_lang";
