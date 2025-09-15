-- CreateEnum
CREATE TYPE "PricingSource" AS ENUM ('OPENAI_API', 'MANUAL', 'WEB_SCRAPING');

-- CreateEnum
CREATE TYPE "AIFeatureType" AS ENUM ('TEXT_GRADING', 'FILE_GRADING', 'IMAGE_GRADING', 'URL_GRADING', 'PRESENTATION_GRADING', 'VIDEO_GRADING', 'QUESTION_GENERATION', 'TRANSLATION', 'RUBRIC_GENERATION', 'CONTENT_MODERATION', 'ASSIGNMENT_GENERATION', 'LIVE_RECORDING_FEEDBACK');

-- CreateTable
CREATE TABLE "LLMModel" (
    "id" SERIAL NOT NULL,
    "modelKey" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LLMModel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LLMPricing" (
    "id" SERIAL NOT NULL,
    "modelId" INTEGER NOT NULL,
    "inputTokenPrice" DOUBLE PRECISION NOT NULL,
    "outputTokenPrice" DOUBLE PRECISION NOT NULL,
    "effectiveDate" TIMESTAMP(3) NOT NULL,
    "source" "PricingSource" NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LLMPricing_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AIFeature" (
    "id" SERIAL NOT NULL,
    "featureKey" TEXT NOT NULL,
    "featureType" "AIFeatureType" NOT NULL,
    "displayName" TEXT NOT NULL,
    "description" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "requiresModel" BOOLEAN NOT NULL DEFAULT true,
    "defaultModelKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AIFeature_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LLMFeatureAssignment" (
    "id" SERIAL NOT NULL,
    "featureId" INTEGER NOT NULL,
    "modelId" INTEGER NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "assignedBy" TEXT,
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deactivatedAt" TIMESTAMP(3),
    "metadata" JSONB,

    CONSTRAINT "LLMFeatureAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "LLMModel_modelKey_key" ON "LLMModel"("modelKey");

-- CreateIndex
CREATE INDEX "LLMModel_modelKey_idx" ON "LLMModel"("modelKey");

-- CreateIndex
CREATE INDEX "LLMModel_provider_idx" ON "LLMModel"("provider");

-- CreateIndex
CREATE INDEX "LLMPricing_modelId_effectiveDate_idx" ON "LLMPricing"("modelId", "effectiveDate");

-- CreateIndex
CREATE INDEX "LLMPricing_effectiveDate_idx" ON "LLMPricing"("effectiveDate");

-- CreateIndex
CREATE INDEX "LLMPricing_isActive_idx" ON "LLMPricing"("isActive");

-- CreateIndex
CREATE UNIQUE INDEX "LLMPricing_modelId_effectiveDate_source_key" ON "LLMPricing"("modelId", "effectiveDate", "source");

-- CreateIndex
CREATE UNIQUE INDEX "AIFeature_featureKey_key" ON "AIFeature"("featureKey");

-- CreateIndex
CREATE INDEX "AIFeature_featureKey_idx" ON "AIFeature"("featureKey");

-- CreateIndex
CREATE INDEX "AIFeature_featureType_idx" ON "AIFeature"("featureType");

-- CreateIndex
CREATE INDEX "AIFeature_isActive_idx" ON "AIFeature"("isActive");

-- CreateIndex
CREATE INDEX "LLMFeatureAssignment_featureId_isActive_idx" ON "LLMFeatureAssignment"("featureId", "isActive");

-- CreateIndex
CREATE INDEX "LLMFeatureAssignment_modelId_idx" ON "LLMFeatureAssignment"("modelId");

-- CreateIndex
CREATE INDEX "LLMFeatureAssignment_isActive_idx" ON "LLMFeatureAssignment"("isActive");

-- CreateIndex
CREATE UNIQUE INDEX "LLMFeatureAssignment_featureId_modelId_isActive_key" ON "LLMFeatureAssignment"("featureId", "modelId", "isActive");

-- CreateIndex
CREATE INDEX "AssignmentAttempt_assignmentId_idx" ON "AssignmentAttempt"("assignmentId");

-- CreateIndex
CREATE INDEX "AssignmentAttempt_userId_idx" ON "AssignmentAttempt"("userId");

-- CreateIndex
CREATE INDEX "AssignmentAttempt_assignmentId_submitted_idx" ON "AssignmentAttempt"("assignmentId", "submitted");

-- CreateIndex
CREATE INDEX "AssignmentAttempt_createdAt_idx" ON "AssignmentAttempt"("createdAt");

-- CreateIndex
CREATE INDEX "AssignmentAttempt_assignmentId_userId_idx" ON "AssignmentAttempt"("assignmentId", "userId");

-- CreateIndex
CREATE INDEX "AssignmentFeedback_assignmentId_idx" ON "AssignmentFeedback"("assignmentId");

-- CreateIndex
CREATE INDEX "AssignmentFeedback_assignmentId_assignmentRating_idx" ON "AssignmentFeedback"("assignmentId", "assignmentRating");

-- AddForeignKey
ALTER TABLE "LLMPricing" ADD CONSTRAINT "LLMPricing_modelId_fkey" FOREIGN KEY ("modelId") REFERENCES "LLMModel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LLMFeatureAssignment" ADD CONSTRAINT "LLMFeatureAssignment_featureId_fkey" FOREIGN KEY ("featureId") REFERENCES "AIFeature"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LLMFeatureAssignment" ADD CONSTRAINT "LLMFeatureAssignment_modelId_fkey" FOREIGN KEY ("modelId") REFERENCES "LLMModel"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Initialize LLMModels table with default models from the system
-- This adds the three OpenAI models that are currently configured in the LLM router

INSERT INTO "LLMModel" ("modelKey", "displayName", "provider", "isActive", "createdAt", "updatedAt") VALUES
('gpt-4o', 'GPT-4 Omni', 'OpenAI', true, NOW(), NOW()),
('gpt-4o-mini', 'GPT-4 Omni Mini', 'OpenAI', true, NOW(), NOW()),
('gpt-4.1-mini', 'GPT-4.1 Mini (Vision)', 'OpenAI', true, NOW(), NOW())
ON CONFLICT ("modelKey") DO NOTHING;

-- Initialize default AIFeature records for the system's AI features
INSERT INTO "AIFeature" ("featureKey", "featureType", "displayName", "description", "isActive", "requiresModel", "defaultModelKey", "createdAt", "updatedAt") VALUES
('text_grading', 'TEXT_GRADING', 'Text Response Grading', 'Automated grading of text-based responses using AI', true, true, 'gpt-4o-mini', NOW(), NOW()),
('file_grading', 'FILE_GRADING', 'File Content Grading', 'Automated grading of file uploads and documents', true, true, 'gpt-4o', NOW(), NOW()),
('image_grading', 'IMAGE_GRADING', 'Image Content Grading', 'Automated grading of image submissions', true, true, 'gpt-4.1-mini', NOW(), NOW()),
('url_grading', 'URL_GRADING', 'URL Content Grading', 'Automated grading of URL submissions', true, true, 'gpt-4o', NOW(), NOW()),
('presentation_grading', 'PRESENTATION_GRADING', 'Presentation Grading', 'Automated grading of presentation files', true, true, 'gpt-4.1-mini', NOW(), NOW()),
('video_grading', 'VIDEO_GRADING', 'Video Grading', 'Automated grading of video presentations', true, true, 'gpt-4.1-mini', NOW(), NOW()),
('question_generation', 'QUESTION_GENERATION', 'Question Generation', 'AI-powered question generation for assignments', true, true, 'gpt-4o', NOW(), NOW()),
('translation', 'TRANSLATION', 'Content Translation', 'AI-powered translation of assignment content', true, true, 'gpt-4o-mini', NOW(), NOW()),
('rubric_generation', 'RUBRIC_GENERATION', 'Rubric Generation', 'AI-powered rubric creation for assignments', true, true, 'gpt-4o', NOW(), NOW()),
('content_moderation', 'CONTENT_MODERATION', 'Content Moderation', 'AI-powered content moderation and safety checks', true, true, 'gpt-4o-mini', NOW(), NOW()),
('assignment_generation', 'ASSIGNMENT_GENERATION', 'Assignment Generation', 'AI-powered assignment creation', true, true, 'gpt-4o', NOW(), NOW()),
('live_recording_feedback', 'LIVE_RECORDING_FEEDBACK', 'Live Recording Feedback', 'AI feedback for live recordings', true, true, 'gpt-4o-mini', NOW(), NOW())
ON CONFLICT ("featureKey") DO NOTHING;

-- Initialize pricing data for all models with historical data going back 1 year
-- This ensures there's always pricing available for any historical date
WITH model_ids AS (
  SELECT id, "modelKey" FROM "LLMModel" WHERE "modelKey" IN ('gpt-4o', 'gpt-4o-mini', 'gpt-4.1-mini')
)
INSERT INTO "LLMPricing" ("modelId", "inputTokenPrice", "outputTokenPrice", "effectiveDate", "source", "isActive", "metadata", "createdAt", "updatedAt") 
SELECT 
  m.id,
  CASE 
    WHEN m."modelKey" = 'gpt-4o' THEN 0.0000025
    WHEN m."modelKey" = 'gpt-4o-mini' THEN 0.00000015
    WHEN m."modelKey" = 'gpt-4.1-mini' THEN 0.0000025
  END as inputTokenPrice,
  CASE 
    WHEN m."modelKey" = 'gpt-4o' THEN 0.00001
    WHEN m."modelKey" = 'gpt-4o-mini' THEN 0.0000006
    WHEN m."modelKey" = 'gpt-4.1-mini' THEN 0.00001
  END as outputTokenPrice,
  '2024-01-01 00:00:00'::timestamp as effectiveDate,
  'MANUAL'::"PricingSource" as source,
  true as isActive,
  jsonb_build_object(
    'note', 'Historical baseline pricing',
    'lastUpdated', NOW()::text
  ) as metadata,
  NOW() as createdAt,
  NOW() as updatedAt
FROM model_ids m;