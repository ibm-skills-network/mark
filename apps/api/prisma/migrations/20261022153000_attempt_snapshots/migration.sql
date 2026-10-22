-- CreateTable
CREATE TABLE "AttemptDefinition" (
    "attemptId" INTEGER NOT NULL,
    "schemaVersion" INTEGER NOT NULL DEFAULT 1,
    "provenance" TEXT NOT NULL DEFAULT 'created',
    "snapshot" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AttemptDefinition_pkey" PRIMARY KEY ("attemptId")
);

-- CreateTable
CREATE TABLE "AttemptDraft" (
    "attemptId" INTEGER NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 0,
    "answers" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AttemptDraft_pkey" PRIMARY KEY ("attemptId")
);

-- CreateTable
CREATE TABLE "AttemptDraftOperation" (
    "attemptId" INTEGER NOT NULL,
    "operationId" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,
    "revision" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AttemptDraftOperation_pkey" PRIMARY KEY ("attemptId","operationId")
);

-- CreateTable
CREATE TABLE "AttemptSubmission" (
    "id" TEXT NOT NULL,
    "attemptId" INTEGER NOT NULL,
    "operationId" TEXT NOT NULL,
    "draftRevision" INTEGER NOT NULL,
    "answers" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AttemptSubmission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AttemptSource" (
    "id" TEXT NOT NULL,
    "attemptId" INTEGER NOT NULL,
    "uploadId" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "bucket" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AttemptSource_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AttemptDraftOperation_attemptId_revision_key" ON "AttemptDraftOperation"("attemptId", "revision");

-- CreateIndex
CREATE UNIQUE INDEX "AttemptSubmission_attemptId_key" ON "AttemptSubmission"("attemptId");

-- CreateIndex
CREATE UNIQUE INDEX "AttemptSubmission_attemptId_operationId_key" ON "AttemptSubmission"("attemptId", "operationId");

-- CreateIndex
CREATE UNIQUE INDEX "AttemptSource_uploadId_key" ON "AttemptSource"("uploadId");

-- CreateIndex
CREATE INDEX "AttemptSource_attemptId_idx" ON "AttemptSource"("attemptId");

-- AddForeignKey
ALTER TABLE "AttemptDefinition" ADD CONSTRAINT "AttemptDefinition_attemptId_fkey" FOREIGN KEY ("attemptId") REFERENCES "AssignmentAttempt"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttemptDraft" ADD CONSTRAINT "AttemptDraft_attemptId_fkey" FOREIGN KEY ("attemptId") REFERENCES "AssignmentAttempt"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttemptDraftOperation" ADD CONSTRAINT "AttemptDraftOperation_attemptId_fkey" FOREIGN KEY ("attemptId") REFERENCES "AssignmentAttempt"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttemptSubmission" ADD CONSTRAINT "AttemptSubmission_attemptId_fkey" FOREIGN KEY ("attemptId") REFERENCES "AssignmentAttempt"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttemptSource" ADD CONSTRAINT "AttemptSource_attemptId_fkey" FOREIGN KEY ("attemptId") REFERENCES "AssignmentAttempt"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


ALTER TABLE "AttemptDraft" ADD CONSTRAINT "AttemptDraft_revision_nonnegative" CHECK (revision >= 0);
ALTER TABLE "AttemptSubmission" ADD CONSTRAINT "AttemptSubmission_revision_nonnegative" CHECK ("draftRevision" >= 0);
ALTER TABLE "AttemptDraftOperation" ADD CONSTRAINT "AttemptDraftOperation_revision_positive" CHECK (revision > 0);
ALTER TABLE "AttemptDefinition" ADD CONSTRAINT "AttemptDefinition_version" CHECK ("schemaVersion" = 1);

-- Protect the historical evidence even from an accidental ORM update or delete.
CREATE FUNCTION reject_attempt_evidence_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Attempt evidence is immutable' USING ERRCODE = '23514';
END;
$$;
CREATE TRIGGER immutable_attempt_definition BEFORE UPDATE OR DELETE ON "AttemptDefinition"
FOR EACH ROW EXECUTE FUNCTION reject_attempt_evidence_mutation();
CREATE TRIGGER immutable_attempt_submission BEFORE UPDATE OR DELETE ON "AttemptSubmission"
FOR EACH ROW EXECUTE FUNCTION reject_attempt_evidence_mutation();
CREATE TRIGGER immutable_attempt_source BEFORE UPDATE OR DELETE ON "AttemptSource"
FOR EACH ROW EXECUTE FUNCTION reject_attempt_evidence_mutation();
CREATE TRIGGER immutable_draft_receipt BEFORE UPDATE OR DELETE ON "AttemptDraftOperation"
FOR EACH ROW EXECUTE FUNCTION reject_attempt_evidence_mutation();

-- Links each committed grade to the immutable answer revision, including against legacy writers.
ALTER TABLE "AssignmentAttempt" ADD COLUMN "resultSubmissionId" TEXT;
CREATE UNIQUE INDEX "AttemptSubmission_attemptId_id_key" ON "AttemptSubmission"("attemptId", id);
ALTER TABLE "AssignmentAttempt" ADD CONSTRAINT "AssignmentAttempt_resultSubmission_fkey"
FOREIGN KEY (id, "resultSubmissionId") REFERENCES "AttemptSubmission"("attemptId", id) ON DELETE RESTRICT;
CREATE FUNCTION guard_snapshot_attempt_result() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM "AttemptDefinition" WHERE "attemptId" = NEW.id) THEN
    IF NEW."assignmentId" IS DISTINCT FROM OLD."assignmentId" OR NEW."userId" IS DISTINCT FROM OLD."userId"
       OR NEW."assignmentVersionId" IS DISTINCT FROM OLD."assignmentVersionId" OR NEW."questionOrder" IS DISTINCT FROM OLD."questionOrder" THEN
      RAISE EXCEPTION 'Pinned attempt identity cannot change' USING ERRCODE = '23514';
    END IF;
    IF (NEW.submitted IS DISTINCT FROM OLD.submitted OR NEW.grade IS DISTINCT FROM OLD.grade)
       AND NEW."resultSubmissionId" IS DISTINCT FROM NULLIF(current_setting('mark.submission_id', true), '') THEN
      RAISE EXCEPTION 'Pinned result requires an authorized submission commit' USING ERRCODE = '23514';
    END IF;
    IF (NEW.submitted OR NEW.grade IS NOT NULL) AND NEW."resultSubmissionId" IS NULL THEN
      RAISE EXCEPTION 'Pinned grade requires its submission identity' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER guard_snapshot_attempt_result BEFORE UPDATE ON "AssignmentAttempt"
FOR EACH ROW EXECUTE FUNCTION guard_snapshot_attempt_result();

CREATE FUNCTION guard_snapshot_question_response() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE target_attempt INTEGER;
BEGIN
  target_attempt := CASE WHEN TG_OP = 'DELETE' THEN OLD."assignmentAttemptId" ELSE NEW."assignmentAttemptId" END;
  IF EXISTS (SELECT 1 FROM "AttemptDefinition" WHERE "attemptId" = target_attempt)
     AND NOT EXISTS (SELECT 1 FROM "AttemptSubmission" WHERE "attemptId" = target_attempt
                    AND id = current_setting('mark.submission_id', true)) THEN
    RAISE EXCEPTION 'Pinned responses require an authorized submission commit' USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER guard_snapshot_question_response BEFORE INSERT OR UPDATE OR DELETE ON "QuestionResponse"
FOR EACH ROW EXECUTE FUNCTION guard_snapshot_question_response();
