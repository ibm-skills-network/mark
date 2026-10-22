BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';
-- CreateTable
CREATE TABLE "ArtifactOriginal" (
    "sourceId" TEXT NOT NULL,
    "checksum" TEXT NOT NULL,
    "byteSize" INTEGER NOT NULL,
    "mediaType" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "etag" TEXT,
    "objectVersion" TEXT,
    "originalUrl" TEXT,
    "resolvedUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ArtifactOriginal_pkey" PRIMARY KEY ("sourceId")
);

-- CreateTable
CREATE TABLE "ArtifactExtraction" (
    "id" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "extractorVersion" TEXT NOT NULL,
    "configHash" TEXT NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'PENDING',
    "leaseToken" TEXT,
    "leaseExpiresAt" TIMESTAMP(3),
    "manifestId" TEXT,
    "errorCode" TEXT,
    "retryable" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ArtifactExtraction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ArtifactManifest" (
    "id" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "manifest" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ArtifactManifest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ArtifactResource" (
    "artifactId" TEXT NOT NULL,
    "resourceId" TEXT NOT NULL,
    "mediaType" TEXT NOT NULL,
    "checksum" TEXT NOT NULL,
    "bytes" BYTEA NOT NULL,

    CONSTRAINT "ArtifactResource_pkey" PRIMARY KEY ("artifactId","resourceId")
);

-- CreateTable
CREATE TABLE "SourceObjectDeletion" (
    "bucket" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SourceObjectDeletion_pkey" PRIMARY KEY ("bucket","storageKey")
);

-- CreateIndex
CREATE INDEX "ArtifactExtraction_state_leaseExpiresAt_idx" ON "ArtifactExtraction"("state", "leaseExpiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "ArtifactExtraction_sourceId_extractorVersion_configHash_key" ON "ArtifactExtraction"("sourceId", "extractorVersion", "configHash");

-- CreateIndex
CREATE INDEX "ArtifactManifest_sourceId_idx" ON "ArtifactManifest"("sourceId");

-- AddForeignKey
ALTER TABLE "ArtifactOriginal" ADD CONSTRAINT "ArtifactOriginal_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "AttemptSource"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ArtifactExtraction" ADD CONSTRAINT "ArtifactExtraction_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "AttemptSource"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ArtifactManifest" ADD CONSTRAINT "ArtifactManifest_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "AttemptSource"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ArtifactResource" ADD CONSTRAINT "ArtifactResource_artifactId_fkey" FOREIGN KEY ("artifactId") REFERENCES "ArtifactManifest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


CREATE TRIGGER immutable_artifactoriginal BEFORE UPDATE OR DELETE ON "ArtifactOriginal" FOR EACH ROW EXECUTE FUNCTION reject_attempt_evidence_mutation();

CREATE TRIGGER immutable_artifactmanifest BEFORE UPDATE OR DELETE ON "ArtifactManifest" FOR EACH ROW EXECUTE FUNCTION reject_attempt_evidence_mutation();

CREATE TRIGGER immutable_artifactresource BEFORE UPDATE OR DELETE ON "ArtifactResource" FOR EACH ROW EXECUTE FUNCTION reject_attempt_evidence_mutation();

CREATE TRIGGER immutable_sourceobjectdeletion BEFORE UPDATE OR DELETE ON "SourceObjectDeletion" FOR EACH ROW EXECUTE FUNCTION reject_attempt_evidence_mutation();

ALTER TABLE "ArtifactOriginal" ADD CONSTRAINT "ArtifactOriginal_checksum" CHECK (checksum ~ '^[a-f0-9]{64}$' AND "byteSize" >= 0);
ALTER TABLE "ArtifactExtraction" ADD CONSTRAINT "ArtifactExtraction_state" CHECK (state IN ('PENDING', 'PROCESSING', 'COMPLETE', 'FAILED'));
COMMIT;
