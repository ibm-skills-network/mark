/* eslint-disable */

import type { NextFunction, Request, Response } from "express";
import { DatabaseConnectionMiddleware } from "./database-connection.middleware";

describe("DatabaseConnectionMiddleware", () => {
  let middleware: DatabaseConnectionMiddleware;
  let prismaService: { $queryRaw: jest.Mock };
  let circuitBreaker: { execute: jest.Mock };

  const createResponse = () =>
    ({
      setHeader: jest.fn(),
    }) as unknown as Response;

  const createRequest = (path: string) =>
    ({
      path,
    }) as unknown as Request;

  beforeEach(() => {
    prismaService = {
      $queryRaw: jest.fn().mockResolvedValue(),
    };

    circuitBreaker = {
      execute: jest
        .fn()
        .mockImplementation(async (operation: () => Promise<unknown>) =>
          operation(),
        ),
    };

    middleware = new DatabaseConnectionMiddleware(
      prismaService as any,
      circuitBreaker as any,
    );
  });

  it("skips database check for health endpoints", async () => {
    const next = jest.fn();

    await middleware.use(
      createRequest("/health/liveness"),
      createResponse(),
      next,
    );

    expect(next).toHaveBeenCalledTimes(1);
    expect(circuitBreaker.execute).not.toHaveBeenCalled();
  });

  it("executes a lightweight query when route is not a health check", async () => {
    const next = jest.fn();

    await middleware.use(
      createRequest("/api/resource"),
      createResponse(),
      next,
    );

    expect(circuitBreaker.execute).toHaveBeenCalledTimes(1);
    expect(prismaService.$queryRaw).toHaveBeenCalledTimes(1);
    expect(next).toHaveBeenCalledTimes(1);
  });

  it("adds degraded header when circuit breaker raises an error", async () => {
    const next = jest.fn();
    const response = createResponse();

    circuitBreaker.execute.mockRejectedValue(new Error("db is down"));

    await middleware.use(createRequest("/api/resource"), response, next);

    expect(response.setHeader).toHaveBeenCalledWith(
      "X-Database-Status",
      "degraded",
    );
    expect(next).toHaveBeenCalledTimes(1);
  });
});
