import { Inject, Injectable } from "@nestjs/common";
import { Operation, OperationEvent, Prisma } from "@prisma/client";
import { isUUID } from "class-validator";
import { WINSTON_MODULE_PROVIDER } from "nest-winston";
import { Logger } from "winston";
import { PrismaService } from "../database/prisma.service";
import { isKnownOperationKind } from "./rust-jobs.config";

// Mirror the column defaults in the migration.
const DEFAULT_MAX_ATTEMPTS = 3;
const DEFAULT_COST = 1;

const MAX_KEY_LENGTH = 512;
const MAX_ATTEMPTS_LIMIT = 25;
// The worker's default credit budget is 8; a costlier operation is never claimed.
const MAX_COST = 8;
// Payloads carry ids, not documents; anything larger is a producer bug.
const MAX_PAYLOAD_BYTES = 256 * 1024;
const EVENTS_PAGE_SIZE = 500;
const EVENT_FIELDS = {
  operationId: true,
  seq: true,
  at: true,
  stage: true,
  percent: true,
  message: true,
  data: true,
} satisfies Prisma.OperationEventSelect;
// The in-flight row can finish between the conflicting insert and the select;
// a couple of retries covers that window.
const ENQUEUE_TRIES = 3;

export interface EnqueueOperationInput {
  kind: string;
  key: string;
  payload: Prisma.InputJsonObject;
  maxAttempts?: number;
  cost?: number;
  runAfter?: Date;
}

export interface EnqueueOperationResult {
  id: string;
  existing: boolean;
}

/** Progress event as returned to callers; the BigInt row id is left out so the
 * result is JSON-serialisable, and seq is the client-facing ordinal. */
export type OperationProgressEvent = Omit<OperationEvent, "id">;

export class InvalidOperationInputError extends Error {
  constructor(reason: string) {
    super(`Invalid operation input: ${reason}`);
    this.name = "InvalidOperationInputError";
  }
}

function isBoundedInt(value: number, min: number, max: number): boolean {
  return Number.isInteger(value) && value >= min && value <= max;
}

/**
 * Writes operations for the Rust worker to claim. Producers only insert and
 * cancel queued rows; every other state change belongs to the worker.
 *
 * Keys are opaque ids and are logged, so a key containing "@" is rejected:
 * User.userId is an email and must never become part of a key.
 */
@Injectable()
export class OperationProducerService {
  private readonly logger: Logger;

  constructor(
    private readonly prisma: PrismaService,
    @Inject(WINSTON_MODULE_PROVIDER) parentLogger: Logger,
  ) {
    this.logger = parentLogger.child({
      context: OperationProducerService.name,
    });
  }

  async enqueue(input: EnqueueOperationInput): Promise<EnqueueOperationResult> {
    const payloadJson = this.validate(input);
    const { kind, key } = input;
    const maxAttempts = input.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
    const cost = input.cost ?? DEFAULT_COST;
    const runAfter = input.runAfter ?? null;
    this.logger.info("operation.enqueue.start", {
      kind,
      key,
      maxAttempts,
      cost,
      runAfter: runAfter?.toISOString(),
    });

    try {
      for (let attempt = 1; attempt <= ENQUEUE_TRIES; attempt++) {
        const inserted = await this.prisma.$queryRaw<Array<{ id: string }>>(
          Prisma.sql`INSERT INTO "operation" ("kind", "key", "payload", "max_attempts", "cost", "run_after") VALUES (${kind}, ${key}, ${payloadJson}::jsonb, ${maxAttempts}, ${cost}, COALESCE(${runAfter}::timestamptz, now())) ON CONFLICT ("kind", "key") WHERE "state" IN ('queued', 'leased') DO NOTHING RETURNING "id"`,
        );
        if (inserted.length > 0) {
          this.logger.info("operation.enqueue.created", {
            kind,
            key,
            operationId: inserted[0].id,
          });
          return { id: inserted[0].id, existing: false };
        }

        const inFlight = await this.prisma.$queryRaw<Array<{ id: string }>>(
          Prisma.sql`SELECT "id" FROM "operation" WHERE "kind" = ${kind} AND "key" = ${key} AND "state" IN ('queued', 'leased') LIMIT 1`,
        );
        if (inFlight.length > 0) {
          this.logger.info("operation.enqueue.existing", {
            kind,
            key,
            operationId: inFlight[0].id,
          });
          return { id: inFlight[0].id, existing: true };
        }
        this.logger.warn("operation.enqueue.inflight-vanished", {
          kind,
          key,
          attempt,
        });
      }
    } catch (error) {
      this.logger.error("operation.enqueue.failed", {
        kind,
        key,
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      });
      throw error;
    }

    const error = new Error(
      `Could not enqueue operation ${kind}/${key} after ${ENQUEUE_TRIES} tries`,
    );
    this.logger.error("operation.enqueue.failed", {
      kind,
      key,
      error: error.message,
      stack: error.stack,
    });
    throw error;
  }

  /** Withdraws a queued operation. Returns false if it is not queued (or unknown). */
  async cancel(id: string): Promise<boolean> {
    if (!isUUID(id)) {
      this.logger.warn("operation.cancel.invalid-id");
      return false;
    }
    this.logger.info("operation.cancel.start", { operationId: id });
    try {
      // finished_at lets retention sweep cancelled rows like finished ones.
      const rows = await this.prisma.$queryRaw<Array<{ id: string }>>(
        Prisma.sql`UPDATE "operation" SET "state" = 'cancelled', "finished_at" = now(), "updated_at" = now() WHERE "id" = ${id}::uuid AND "state" = 'queued' RETURNING "id"`,
      );
      const cancelled = rows.length > 0;
      this.logger.info("operation.cancel.done", {
        operationId: id,
        cancelled,
      });
      return cancelled;
    } catch (error) {
      this.logger.error("operation.cancel.failed", {
        operationId: id,
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      });
      throw error;
    }
  }

  async get(id: string): Promise<Operation | null> {
    if (!isUUID(id)) {
      this.logger.warn("operation.get.invalid-id");
      return null;
    }
    try {
      const operation = await this.prisma.operation.findUnique({
        where: { id },
      });
      this.logger.debug("operation.get", {
        operationId: id,
        found: operation !== null,
        state: operation?.state,
      });
      return operation;
    } catch (error) {
      this.logger.error("operation.get.failed", {
        operationId: id,
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      });
      throw error;
    }
  }

  /** Progress events after `afterSeq` in order, at most one page. */
  async events(id: string, afterSeq = 0): Promise<OperationProgressEvent[]> {
    if (!isUUID(id) || !isBoundedInt(afterSeq, 0, 2_147_483_647)) {
      this.logger.warn("operation.events.invalid-input", { afterSeq });
      return [];
    }
    try {
      const events = await this.prisma.operationEvent.findMany({
        where: { operationId: id, seq: { gt: afterSeq } },
        orderBy: { seq: "asc" },
        take: EVENTS_PAGE_SIZE,
        select: EVENT_FIELDS,
      });
      this.logger.debug("operation.events", {
        operationId: id,
        afterSeq,
        count: events.length,
      });
      return events;
    } catch (error) {
      this.logger.error("operation.events.failed", {
        operationId: id,
        afterSeq,
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      });
      throw error;
    }
  }

  /** Returns the serialized payload once every field is in bounds. */
  private validate(input: EnqueueOperationInput): string {
    const reject = (reason: string): never => {
      this.logger.warn("operation.enqueue.rejected", {
        kind: typeof input.kind === "string" ? input.kind : undefined,
        reason,
      });
      throw new InvalidOperationInputError(reason);
    };

    if (typeof input.kind !== "string" || !isKnownOperationKind(input.kind)) {
      reject("unknown kind");
    }
    if (
      typeof input.key !== "string" ||
      input.key.trim().length === 0 ||
      input.key.length > MAX_KEY_LENGTH
    ) {
      reject("key must be a non-empty string up to 512 characters");
    }
    if (input.key.includes("@")) {
      reject("key must be an opaque id; it must not contain an email address");
    }
    if (
      input.payload === null ||
      typeof input.payload !== "object" ||
      Array.isArray(input.payload)
    ) {
      reject("payload must be a JSON object");
    }
    if (
      input.maxAttempts !== undefined &&
      !isBoundedInt(input.maxAttempts, 1, MAX_ATTEMPTS_LIMIT)
    ) {
      reject(`maxAttempts must be an integer in 1..${MAX_ATTEMPTS_LIMIT}`);
    }
    if (input.cost !== undefined && !isBoundedInt(input.cost, 1, MAX_COST)) {
      reject(`cost must be an integer in 1..${MAX_COST}`);
    }
    if (
      input.runAfter !== undefined &&
      !(
        input.runAfter instanceof Date &&
        Number.isFinite(input.runAfter.getTime())
      )
    ) {
      reject("runAfter must be a valid Date");
    }

    let payloadJson: string;
    try {
      payloadJson = JSON.stringify(input.payload);
    } catch (error) {
      this.logger.warn("operation.enqueue.payload-unserializable", {
        kind: input.kind,
        error: error instanceof Error ? error.message : String(error),
      });
      throw new InvalidOperationInputError("payload is not serializable");
    }
    if (Buffer.byteLength(payloadJson, "utf8") > MAX_PAYLOAD_BYTES) {
      reject(`payload exceeds ${MAX_PAYLOAD_BYTES} bytes`);
    }
    return payloadJson;
  }
}
