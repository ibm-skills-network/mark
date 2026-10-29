-- CreateTable
CREATE TABLE "GradingModeConfig" (
    "id" SERIAL NOT NULL,
    "questionType" "QuestionType" NOT NULL,
    "assignmentId" INTEGER,
    "mode" TEXT NOT NULL DEFAULT 'off',
    "effort" TEXT,
    "updatedBy" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GradingModeConfig_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "GradingModeConfig_mode_check" CHECK ("mode" IN ('off', 'shadow', 'live')),
    CONSTRAINT "GradingModeConfig_effort_check" CHECK ("effort" IS NULL OR "effort" IN ('low', 'medium', 'high'))
);

-- CreateIndex
CREATE UNIQUE INDEX "GradingModeConfig_questionType_assignmentId_key" ON "GradingModeConfig"("questionType", "assignmentId");

-- A unique index treats NULLs as distinct, so the global row (assignmentId
-- NULL) needs its own index to stay one per question type.
CREATE UNIQUE INDEX "GradingModeConfig_questionType_global_key" ON "GradingModeConfig"("questionType") WHERE "assignmentId" IS NULL;
