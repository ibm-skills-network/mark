-- CreateTable
CREATE TABLE "AuthorSettings" (
    "id" SERIAL NOT NULL,
    "userId" TEXT NOT NULL,
    "emailOnRegradingRequest" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AuthorSettings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AuthorSettings_userId_key" ON "AuthorSettings"("userId");

-- CreateIndex
CREATE INDEX "AuthorSettings_userId_idx" ON "AuthorSettings"("userId");
