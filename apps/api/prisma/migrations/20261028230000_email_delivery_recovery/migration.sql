CREATE TABLE "EmailDeliveryHold" (
  "email" TEXT NOT NULL PRIMARY KEY,
  "source" TEXT NOT NULL,
  "stage" INTEGER NOT NULL,
  "reason" TEXT NOT NULL,
  "holdUntil" TIMESTAMP(3) NOT NULL,
  "lastFailureAt" TIMESTAMP(3) NOT NULL,
  "probeToken" TEXT,
  "probeStartedAt" TIMESTAMP(3),
  "probeAcceptedAt" TIMESTAMP(3),
  "recoveredAt" TIMESTAMP(3)
);
CREATE INDEX "EmailDeliveryHold_source_recoveredAt_idx" ON "EmailDeliveryHold"("source", "recoveredAt");
CREATE INDEX "EmailBounceEvent_source_email_occurredAt_idx" ON "EmailBounceEvent"("source", "email", "occurredAt");
ALTER TABLE "EmailBouncePollState" ADD COLUMN "lastSenderAlertAt" TIMESTAMP(3);
