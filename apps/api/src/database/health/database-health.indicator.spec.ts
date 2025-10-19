/* eslint-disable */

import type { HealthIndicatorResult } from "@nestjs/terminus";
import { DatabaseHealthIndicator } from "./database-health.indicator";

describe("DatabaseHealthIndicator", () => {
  const stats = { state: "CLOSED", failureCount: 0 };

  let prismaService: {
    isHealthy: jest.Mock;
    reconnect: jest.Mock;
  };
  let circuitBreaker: {
    execute: jest.Mock;
    getStats: jest.Mock;
  };
  let indicator: DatabaseHealthIndicator;

  const getStatus = (result: HealthIndicatorResult) => result.database;

  beforeEach(() => {
    prismaService = {
      isHealthy: jest.fn(),
      reconnect: jest.fn(),
    };

    circuitBreaker = {
      execute: jest
        .fn()
        .mockImplementation((function_: () => Promise<unknown>) => function_()),
      getStats: jest.fn().mockReturnValue(stats),
    };

    indicator = new DatabaseHealthIndicator(
      prismaService as any,
      circuitBreaker as any,
    );
  });

  it("reports healthy status when Prisma reports healthy", async () => {
    prismaService.isHealthy.mockResolvedValue(true);

    const result = await indicator.checkDatabase("database");

    const status = getStatus(result);
    expect(status.status).toBe("up");
    expect(status.circuitBreaker).toBe(stats);
    expect(prismaService.reconnect).not.toHaveBeenCalled();
  });

  it("attempts recovery when Prisma reports unhealthy and succeeds", async () => {
    prismaService.isHealthy.mockResolvedValue(false);
    prismaService.reconnect.mockResolvedValue();

    const result = await indicator.checkDatabase("database");

    const status = getStatus(result);
    expect(status.status).toBe("up");
    expect(status.message).toBe("Database reconnected successfully");
    expect(prismaService.reconnect).toHaveBeenCalledTimes(1);
  });

  it("reports down status when recovery fails", async () => {
    prismaService.isHealthy.mockResolvedValue(false);
    prismaService.reconnect.mockRejectedValue(new Error("reconnect failed"));

    const result = await indicator.checkDatabase("database");

    const status = getStatus(result);
    expect(status.status).toBe("down");
    expect(status.message).toBe(
      "Database connection lost and reconnection failed",
    );
    expect(status.error).toBe("reconnect failed");
  });

  it("reports down status when circuit breaker throws", async () => {
    circuitBreaker.execute.mockRejectedValue(new Error("breaker is open"));

    const result = await indicator.checkDatabase("database");

    const status = getStatus(result);
    expect(status.status).toBe("down");
    expect(status.message).toBe("breaker is open");
  });
});
