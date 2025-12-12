-- CreateTable
CREATE TABLE "AdminCache" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AdminCache_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE INDEX "AdminCache_expiresAt_idx" ON "AdminCache"("expiresAt");
