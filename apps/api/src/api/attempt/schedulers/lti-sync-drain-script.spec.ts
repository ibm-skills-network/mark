// The lti-sync-drain CronJob selects rows itself and then calls the retry
// endpoint, so its selection must stay in step with LtiGradeSyncService.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const drain = require("../../../../../../scripts/lti-sync-drain.js") as {
  buildWhere: (
    args: {
      all: boolean;
      since: string;
      includeFailed: boolean;
      ignoreNextRetry: boolean;
    },
    cursorId: number | null,
    now: Date,
  ) => Record<string, unknown>;
  ORPHANED_SYNC_STALE_MS: number;
};

import { ORPHANED_SYNC_STALE_MS } from "../services/lti-grade-sync.service";

type Clause = Record<string, unknown> & { status?: unknown };

const baseArgs = {
  all: true,
  since: "2026-05-25T18:31:00Z",
  includeFailed: false,
  ignoreNextRetry: false,
};

function selectionClauses(where: Record<string, unknown>): Clause[] {
  const and = where.AND as Record<string, unknown>[];
  const withOr = and.find((clause) => Array.isArray(clause.OR));
  return (withOr?.OR ?? []) as Clause[];
}

describe("lti-sync-drain row selection", () => {
  const now = new Date("2026-10-22T12:00:00Z");
  const staleBefore = new Date(now.getTime() - ORPHANED_SYNC_STALE_MS);

  it("uses the same staleness threshold as the service", () => {
    expect(drain.ORPHANED_SYNC_STALE_MS).toBe(ORPHANED_SYNC_STALE_MS);
  });

  it("selects due SCHEDULED rows", () => {
    const clauses = selectionClauses(drain.buildWhere(baseArgs, null, now));
    expect(clauses).toContainEqual({
      status: { in: ["SCHEDULED"] },
      OR: [{ nextRetryAt: { lte: now } }, { nextRetryAt: null }],
    });
  });

  it("selects PENDING rows orphaned for longer than the threshold", () => {
    const clauses = selectionClauses(drain.buildWhere(baseArgs, null, now));
    expect(clauses).toContainEqual({
      status: "PENDING",
      createdAt: { lt: staleBefore },
    });
  });

  it("selects IN_PROGRESS rows whose claim has gone stale", () => {
    const clauses = selectionClauses(drain.buildWhere(baseArgs, null, now));
    expect(clauses).toContainEqual({
      status: "IN_PROGRESS",
      lastAttemptAt: { lt: staleBefore },
    });
    expect(clauses).toContainEqual({
      status: "IN_PROGRESS",
      lastAttemptAt: null,
      updatedAt: { lt: staleBefore },
    });
  });

  it("keeps the --since window and the cursor", () => {
    const where = drain.buildWhere({ ...baseArgs, all: false }, 42, now);
    const and = where.AND as Record<string, unknown>[];
    expect(and).toContainEqual({
      createdAt: { gte: new Date(baseArgs.since) },
    });
    expect(and).toContainEqual({ id: { gt: 42 } });
  });

  it("adds FAILED to the retryable statuses only with --include-failed", () => {
    const clauses = selectionClauses(
      drain.buildWhere({ ...baseArgs, includeFailed: true }, null, now),
    );
    expect(clauses[0]).toEqual(
      expect.objectContaining({ status: { in: ["SCHEDULED", "FAILED"] } }),
    );
  });
});
