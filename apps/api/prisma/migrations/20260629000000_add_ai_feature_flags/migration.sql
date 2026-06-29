-- CreateTable
CREATE TABLE "AiFeatureFlag" (
    "id" SERIAL NOT NULL,
    "component" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL,
    "updatedBy" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiFeatureFlag_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AiFeatureFlag_component_key" ON "AiFeatureFlag"("component");
