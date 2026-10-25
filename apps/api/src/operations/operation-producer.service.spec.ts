import { Prisma } from "@prisma/client";
import { Logger } from "winston";
import { PrismaService } from "../database/prisma.service";
import {
  InvalidOperationInputError,
  OperationProducerService,
} from "./operation-producer.service";

// Pins the statements the producer sends; the Rust store depends on the same
// shapes (partial-index conflict target, queued-only cancel).

const ID = "3f1c2b9a-6a4e-4d2b-9a77-0c1d2e3f4a5b";

const makeService = () => {
  const prisma = {
    $queryRaw: jest.fn(),
    operation: { findUnique: jest.fn() },
    operationEvent: { findMany: jest.fn() },
  };
  const log = {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  };
  const logger = { child: () => log } as unknown as Logger;
  const service = new OperationProducerService(
    prisma as unknown as PrismaService,
    logger,
  );
  return { service, prisma, log };
};

const statement = (mock: jest.Mock, call: number): Prisma.Sql =>
  mock.mock.calls[call][0] as Prisma.Sql;

describe("OperationProducerService.enqueue", () => {
  it("inserts with the in-flight conflict target and returns the new id", async () => {
    const { service, prisma, log } = makeService();
    prisma.$queryRaw.mockResolvedValueOnce([{ id: ID }]);

    const result = await service.enqueue({
      kind: "translate.meta",
      key: "assignment:42",
      payload: { assignmentId: 42 },
    });

    expect(result).toEqual({ id: ID, existing: false });
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
    const sql = statement(prisma.$queryRaw, 0);
    expect(sql.text).toBe(
      `INSERT INTO "operation" ("kind", "key", "payload", "max_attempts", "cost", "run_after") VALUES ($1, $2, $3::jsonb, $4, $5, COALESCE($6::timestamptz, now())) ON CONFLICT ("kind", "key") WHERE "state" IN ('queued', 'leased') DO NOTHING RETURNING "id"`,
    );
    expect(sql.values).toEqual([
      "translate.meta",
      "assignment:42",
      '{"assignmentId":42}',
      3,
      1,
      null,
    ]);
    expect(log.info).toHaveBeenCalledWith("operation.enqueue.created", {
      kind: "translate.meta",
      key: "assignment:42",
      operationId: ID,
    });
  });

  it("passes explicit attempts, cost and run_after", async () => {
    const { service, prisma } = makeService();
    prisma.$queryRaw.mockResolvedValueOnce([{ id: ID }]);
    const runAfter = new Date("2026-10-26T00:00:00Z");

    await service.enqueue({
      kind: "grading.heavy",
      key: "attempt:7",
      payload: { attemptId: 7 },
      maxAttempts: 5,
      cost: 4,
      runAfter,
    });

    expect(statement(prisma.$queryRaw, 0).values).toEqual([
      "grading.heavy",
      "attempt:7",
      '{"attemptId":7}',
      5,
      4,
      runAfter,
    ]);
  });

  it("returns the in-flight row when the insert conflicts", async () => {
    const { service, prisma } = makeService();
    prisma.$queryRaw
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: ID }]);

    const result = await service.enqueue({
      kind: "assignment.publish",
      key: "assignment:9",
      payload: {},
    });

    expect(result).toEqual({ id: ID, existing: true });
    const select = statement(prisma.$queryRaw, 1);
    expect(select.text).toBe(
      `SELECT "id" FROM "operation" WHERE "kind" = $1 AND "key" = $2 AND "state" IN ('queued', 'leased') LIMIT 1`,
    );
    expect(select.values).toEqual(["assignment.publish", "assignment:9"]);
  });

  it("retries the insert when the in-flight row finished in between", async () => {
    const { service, prisma, log } = makeService();
    prisma.$queryRaw
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: ID }]);

    const result = await service.enqueue({
      kind: "grading.standard",
      key: "attempt:1",
      payload: {},
    });

    expect(result).toEqual({ id: ID, existing: false });
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(3);
    expect(log.warn).toHaveBeenCalledWith(
      "operation.enqueue.inflight-vanished",
      expect.objectContaining({ attempt: 1 }),
    );
  });

  it("gives up after bounded retries", async () => {
    const { service, prisma } = makeService();
    prisma.$queryRaw.mockResolvedValue([]);

    await expect(
      service.enqueue({ kind: "grading.standard", key: "a", payload: {} }),
    ).rejects.toThrow("after 3 tries");
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(6);
  });

  it("logs and rethrows database errors", async () => {
    const { service, prisma, log } = makeService();
    prisma.$queryRaw.mockRejectedValueOnce(new Error("boom"));

    await expect(
      service.enqueue({ kind: "grading.standard", key: "a", payload: {} }),
    ).rejects.toThrow("boom");
    expect(log.error).toHaveBeenCalledWith(
      "operation.enqueue.failed",
      expect.objectContaining({ error: "boom" }),
    );
  });

  it.each<[string, Record<string, unknown>]>([
    ["unknown kind", { kind: "grading" }],
    ["empty key", { key: "  " }],
    ["oversized key", { key: "k".repeat(513) }],
    ["array payload", { payload: [] }],
    ["null payload", { payload: null }],
    ["zero attempts", { maxAttempts: 0 }],
    ["fractional attempts", { maxAttempts: 1.5 }],
    ["too many attempts", { maxAttempts: 26 }],
    ["zero cost", { cost: 0 }],
    ["cost above the credit budget", { cost: 9 }],
    ["email in key", { key: "attempt:1:learner@example.com" }],
    ["invalid date", { runAfter: new Date("nope") }],
    ["string date", { runAfter: "2026-10-26" }],
    ["oversized payload", { payload: { blob: "x".repeat(256 * 1024) } }],
  ])("rejects %s without touching the database", async (_label, override) => {
    const { service, prisma } = makeService();
    const input = {
      kind: "grading.standard",
      key: "attempt:1",
      payload: { attemptId: 1 },
      ...override,
    } as Parameters<OperationProducerService["enqueue"]>[0];

    await expect(service.enqueue(input)).rejects.toBeInstanceOf(
      InvalidOperationInputError,
    );
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
  });
});

describe("OperationProducerService key rules", () => {
  it("rejects a key with an email and never logs it", async () => {
    const { service, prisma, log } = makeService();
    const key = "attempt:1:learner@example.com";

    await expect(
      service.enqueue({ kind: "grading.standard", key, payload: {} }),
    ).rejects.toThrow("must not contain an email address");
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
    const logged = JSON.stringify([
      log.info.mock.calls,
      log.warn.mock.calls,
      log.error.mock.calls,
    ]);
    expect(logged).not.toContain("example.com");
  });
});

describe("OperationProducerService.cancel", () => {
  it("only cancels a queued row and stamps finished_at", async () => {
    const { service, prisma } = makeService();
    prisma.$queryRaw.mockResolvedValueOnce([{ id: ID }]);

    await expect(service.cancel(ID)).resolves.toBe(true);
    const sql = statement(prisma.$queryRaw, 0);
    expect(sql.text).toBe(
      `UPDATE "operation" SET "state" = 'cancelled', "finished_at" = now(), "updated_at" = now() WHERE "id" = $1::uuid AND "state" = 'queued' RETURNING "id"`,
    );
    expect(sql.values).toEqual([ID]);
  });

  it("returns false when nothing was queued", async () => {
    const { service, prisma } = makeService();
    prisma.$queryRaw.mockResolvedValueOnce([]);
    await expect(service.cancel(ID)).resolves.toBe(false);
  });

  it("returns false for a malformed id without querying", async () => {
    const { service, prisma } = makeService();
    await expect(service.cancel("1; DROP TABLE operation")).resolves.toBe(
      false,
    );
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
  });
});

describe("OperationProducerService reads", () => {
  it("gets an operation by id", async () => {
    const { service, prisma } = makeService();
    const row = { id: ID, state: "queued" };
    prisma.operation.findUnique.mockResolvedValueOnce(row);

    await expect(service.get(ID)).resolves.toBe(row);
    expect(prisma.operation.findUnique).toHaveBeenCalledWith({
      where: { id: ID },
    });
  });

  it("returns null for a malformed id", async () => {
    const { service, prisma } = makeService();
    await expect(service.get("abc")).resolves.toBeNull();
    expect(prisma.operation.findUnique).not.toHaveBeenCalled();
  });

  it("pages events after a sequence number", async () => {
    const { service, prisma } = makeService();
    prisma.operationEvent.findMany.mockResolvedValueOnce([]);

    await service.events(ID, 4);
    expect(prisma.operationEvent.findMany).toHaveBeenCalledWith({
      where: { operationId: ID, seq: { gt: 4 } },
      orderBy: { seq: "asc" },
      take: 500,
      select: {
        operationId: true,
        seq: true,
        at: true,
        stage: true,
        percent: true,
        message: true,
        data: true,
      },
    });
  });

  it("returns events that JSON-serialise (no BigInt id)", async () => {
    const { service, prisma } = makeService();
    const row = {
      operationId: ID,
      seq: 1,
      at: new Date("2026-10-25T00:00:00Z"),
      stage: "claimed",
      percent: null,
      message: null,
      data: null,
    };
    prisma.operationEvent.findMany.mockResolvedValueOnce([row]);

    const events = await service.events(ID, 0);
    expect(events[0]).not.toHaveProperty("id");
    expect(() => JSON.stringify(events)).not.toThrow();
  });

  it.each([-1, 1.5, Number.NaN])(
    "returns no events for afterSeq %p",
    async (afterSeq) => {
      const { service, prisma } = makeService();
      await expect(service.events(ID, afterSeq)).resolves.toEqual([]);
      expect(prisma.operationEvent.findMany).not.toHaveBeenCalled();
    },
  );
});
