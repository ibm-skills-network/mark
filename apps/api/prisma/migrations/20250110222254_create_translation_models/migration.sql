-- CreateTable
CREATE TABLE "Translation" (
    "id" SERIAL NOT NULL,
    "questionId" INTEGER NOT NULL,
    "languageCode" TEXT NOT NULL,
    "translatedText" TEXT NOT NULL,
    "untranslatedText" TEXT NOT NULL,
    "translatedChoices" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Translation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Translation_questionId_languageCode_key" ON "Translation"("questionId", "languageCode");

-- AddForeignKey
ALTER TABLE "Translation" ADD CONSTRAINT "Translation_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "Question"("id") ON DELETE CASCADE ON UPDATE CASCADE;
