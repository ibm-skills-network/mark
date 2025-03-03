-- DropIndex
DROP INDEX "unique_question_lang";

-- DropIndex
DROP INDEX "unique_variant_lang";

-- CreateIndex
CREATE INDEX "Translation_questionId_variantId_languageCode_idx" ON "Translation"("questionId", "variantId", "languageCode");
