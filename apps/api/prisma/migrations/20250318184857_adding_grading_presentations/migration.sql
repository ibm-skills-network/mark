-- AlterEnum
ALTER TYPE "AIUsageType" ADD VALUE 'LIVE_RECORDING_FEEDBACK';

-- AlterEnum
ALTER TYPE "ResponseType" ADD VALUE 'LIVE_RECORDING';

-- AlterTable
ALTER TABLE "Question" ADD COLUMN     "liveRecordingConfig" JSONB,
ADD COLUMN     "videoPresentationConfig" JSONB;
