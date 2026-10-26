-- Durable operation store for the Rust worker. Background work is a row
-- here, claimed with a lease; progress is a row in operation_event; external
-- effects (grade passback, email) are rows in operation_outbox written in
-- the same transaction as the result they report.

CREATE TABLE "operation" (
    "id"           UUID         NOT NULL DEFAULT gen_random_uuid(),
    "kind"         TEXT         NOT NULL,
    "key"          TEXT         NOT NULL,
    "payload"      JSONB        NOT NULL,
    "state"        TEXT         NOT NULL DEFAULT 'queued',
    "attempts"     INTEGER      NOT NULL DEFAULT 0,
    "max_attempts" INTEGER      NOT NULL DEFAULT 3,
    "cost"         INTEGER      NOT NULL DEFAULT 1,
    "run_after"    TIMESTAMPTZ  NOT NULL DEFAULT now(),
    "lease_owner"  TEXT,
    "lease_until"  TIMESTAMPTZ,
    "last_error"   TEXT,
    "created_at"   TIMESTAMPTZ  NOT NULL DEFAULT now(),
    "updated_at"   TIMESTAMPTZ  NOT NULL DEFAULT now(),
    "finished_at"  TIMESTAMPTZ,

    CONSTRAINT "operation_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "operation_state_check" CHECK ("state" IN ('queued', 'leased', 'succeeded', 'failed', 'dead', 'cancelled')),
    CONSTRAINT "operation_cost_check" CHECK ("cost" >= 1),
    CONSTRAINT "operation_lease_check" CHECK (("state" = 'leased') = ("lease_owner" IS NOT NULL AND "lease_until" IS NOT NULL))
);

-- One in-flight operation per (kind, key); a finished one may be re-run.
CREATE UNIQUE INDEX "operation_kind_key_inflight_idx" ON "operation" ("kind", "key") WHERE "state" IN ('queued', 'leased');
-- The claim query.
CREATE INDEX "operation_queued_run_after_idx" ON "operation" ("run_after") WHERE "state" = 'queued';
-- The reaper.
CREATE INDEX "operation_leased_until_idx" ON "operation" ("lease_until") WHERE "state" = 'leased';
-- Status lookups and retention.
CREATE INDEX "operation_kind_state_idx" ON "operation" ("kind", "state");
CREATE INDEX "operation_finished_at_idx" ON "operation" ("finished_at") WHERE "finished_at" IS NOT NULL;

CREATE TABLE "operation_event" (
    "id"           BIGSERIAL    NOT NULL,
    "operation_id" UUID         NOT NULL,
    "seq"          INTEGER      NOT NULL,
    "at"           TIMESTAMPTZ  NOT NULL DEFAULT now(),
    "stage"        TEXT         NOT NULL,
    "percent"      SMALLINT,
    "message"      TEXT,
    "data"         JSONB,

    CONSTRAINT "operation_event_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "operation_event_operation_id_fkey" FOREIGN KEY ("operation_id") REFERENCES "operation" ("id") ON DELETE CASCADE,
    CONSTRAINT "operation_event_percent_check" CHECK ("percent" IS NULL OR ("percent" >= 0 AND "percent" <= 100))
);

CREATE UNIQUE INDEX "operation_event_operation_id_seq_key" ON "operation_event" ("operation_id", "seq");

CREATE TABLE "operation_outbox" (
    "id"           UUID         NOT NULL DEFAULT gen_random_uuid(),
    "operation_id" UUID,
    "kind"         TEXT         NOT NULL,
    "payload"      JSONB        NOT NULL,
    "state"        TEXT         NOT NULL DEFAULT 'pending',
    "attempts"     INTEGER      NOT NULL DEFAULT 0,
    "max_attempts" INTEGER      NOT NULL DEFAULT 5,
    "run_after"    TIMESTAMPTZ  NOT NULL DEFAULT now(),
    "lease_owner"  TEXT,
    "lease_until"  TIMESTAMPTZ,
    "last_error"   TEXT,
    "created_at"   TIMESTAMPTZ  NOT NULL DEFAULT now(),
    "updated_at"   TIMESTAMPTZ  NOT NULL DEFAULT now(),
    "sent_at"      TIMESTAMPTZ,

    CONSTRAINT "operation_outbox_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "operation_outbox_operation_id_fkey" FOREIGN KEY ("operation_id") REFERENCES "operation" ("id") ON DELETE SET NULL,
    CONSTRAINT "operation_outbox_state_check" CHECK ("state" IN ('pending', 'leased', 'sent', 'dead')),
    CONSTRAINT "operation_outbox_lease_check" CHECK (("state" = 'leased') = ("lease_owner" IS NOT NULL AND "lease_until" IS NOT NULL))
);

CREATE INDEX "operation_outbox_pending_run_after_idx" ON "operation_outbox" ("run_after") WHERE "state" = 'pending';
CREATE INDEX "operation_outbox_leased_until_idx" ON "operation_outbox" ("lease_until") WHERE "state" = 'leased';
CREATE INDEX "operation_outbox_sent_at_idx" ON "operation_outbox" ("sent_at") WHERE "sent_at" IS NOT NULL;
