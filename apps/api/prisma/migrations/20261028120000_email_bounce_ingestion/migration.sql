CREATE TABLE "EmailSuppressionRelease" (
  "email" TEXT NOT NULL PRIMARY KEY,
  "releasedAt" TIMESTAMP(3) NOT NULL,
  "releasedBy" TEXT NOT NULL
);

CREATE TABLE "EmailBounceEvent" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "source" TEXT NOT NULL,
  "email" TEXT NOT NULL,
  "domain" TEXT NOT NULL,
  "reason" TEXT NOT NULL,
  "occurredAt" TIMESTAMP(3) NOT NULL,
  "ingestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "EmailBounceEvent_source_occurredAt_idx" ON "EmailBounceEvent"("source", "occurredAt");

CREATE TABLE "EmailBouncePollState" (
  "source" TEXT NOT NULL PRIMARY KEY,
  "leaseToken" TEXT,
  "leaseUntil" TIMESTAMP(3),
  "lastSuccessAt" TIMESTAMP(3),
  "lastError" TEXT
);
