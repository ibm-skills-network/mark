-- The nightly retention sweep selects LtiGradeSync rows by age.
CREATE INDEX "LtiGradeSync_updatedAt_idx" ON "LtiGradeSync"("updatedAt");

-- LZ4 TOAST compression for the large text and JSON columns: new values
-- compress and decompress faster than pglz; existing values keep pglz until
-- the row is rewritten. Requires PostgreSQL 14+.
ALTER TABLE "QuestionResponse"
  ALTER COLUMN "learnerResponse" SET COMPRESSION lz4,
  ALTER COLUMN "feedback" SET COMPRESSION lz4,
  ALTER COLUMN "metadata" SET COMPRESSION lz4;

ALTER TABLE "GradingAudit"
  ALTER COLUMN "requestPayload" SET COMPRESSION lz4,
  ALTER COLUMN "responsePayload" SET COMPRESSION lz4,
  ALTER COLUMN "metadata" SET COMPRESSION lz4;

ALTER TABLE "GradingCache"
  ALTER COLUMN "criteria" SET COMPRESSION lz4,
  ALTER COLUMN "overallFeedback" SET COMPRESSION lz4,
  ALTER COLUMN "metadata" SET COMPRESSION lz4;

ALTER TABLE "AssignmentAttemptQuestionVariant"
  ALTER COLUMN "randomizedChoices" SET COMPRESSION lz4;

ALTER TABLE "LtiGradeSync"
  ALTER COLUMN "authCookie" SET COMPRESSION lz4,
  ALTER COLUMN "errorHistory" SET COMPRESSION lz4;
