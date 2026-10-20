CREATE TABLE "RichTextMigrationRun" (
  "id" TEXT PRIMARY KEY,
  "target" TEXT NOT NULL,
  "fingerprint" TEXT NOT NULL,
  "scope" INTEGER[] NOT NULL,
  "origin" TEXT NOT NULL,
  "byteLimit" INTEGER NOT NULL CHECK ("byteLimit" > 0),
  "status" TEXT NOT NULL DEFAULT 'planned',
  "operation" TEXT NOT NULL DEFAULT 'apply',
  "cursor" JSONB NOT NULL DEFAULT '{}',
  "upper" JSONB NOT NULL DEFAULT '{}',
  "cleanSweeps" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE "RichTextMigrationLease" (
  "key" TEXT PRIMARY KEY,
  "runId" TEXT REFERENCES "RichTextMigrationRun"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "owner" TEXT,
  "generation" BIGINT NOT NULL DEFAULT 0,
  "expiresAt" TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE "RichTextMigrationItem" (
  "id" TEXT PRIMARY KEY,
  "runId" TEXT NOT NULL REFERENCES "RichTextMigrationRun"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "model" TEXT NOT NULL,
  "rowId" INTEGER NOT NULL,
  "sourceHash" TEXT NOT NULL,
  "context" TEXT,
  "destinationHash" TEXT,
  "state" TEXT NOT NULL,
  "reason" TEXT,
  "rules" TEXT[] NOT NULL DEFAULT '{}',
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "retryAt" TIMESTAMPTZ,
  "successorId" TEXT REFERENCES "RichTextMigrationItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  UNIQUE ("runId", "model", "rowId", "sourceHash")
);
CREATE INDEX "RichTextMigrationItem_work" ON "RichTextMigrationItem"("runId", "state", "retryAt");
CREATE TABLE "RichTextMigrationBackup" (
  "id" TEXT PRIMARY KEY,
  "sequence" BIGSERIAL UNIQUE NOT NULL,
  "itemId" TEXT UNIQUE NOT NULL REFERENCES "RichTextMigrationItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "before" JSONB NOT NULL,
  "after" JSONB NOT NULL,
  "beforeHash" TEXT NOT NULL,
  "afterHash" TEXT NOT NULL,
  "appliedAt" TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  "rolledBackAt" TIMESTAMPTZ,
  "rollbackState" TEXT NOT NULL DEFAULT 'pending'
);
