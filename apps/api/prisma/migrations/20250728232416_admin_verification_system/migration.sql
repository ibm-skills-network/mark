-- CreateTable
CREATE TABLE "AdminVerificationCode" (
    "id" SERIAL NOT NULL,
    "email" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "used" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "AdminVerificationCode_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdminSession" (
    "id" SERIAL NOT NULL,
    "email" TEXT NOT NULL,
    "sessionToken" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AdminSession_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AdminVerificationCode_email_idx" ON "AdminVerificationCode"("email");

-- CreateIndex
CREATE INDEX "AdminVerificationCode_code_idx" ON "AdminVerificationCode"("code");

-- CreateIndex
CREATE INDEX "AdminVerificationCode_expiresAt_idx" ON "AdminVerificationCode"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "AdminSession_sessionToken_key" ON "AdminSession"("sessionToken");

-- CreateIndex
CREATE INDEX "AdminSession_email_idx" ON "AdminSession"("email");

-- CreateIndex
CREATE INDEX "AdminSession_sessionToken_idx" ON "AdminSession"("sessionToken");

-- CreateIndex
CREATE INDEX "AdminSession_expiresAt_idx" ON "AdminSession"("expiresAt");
