/* eslint-disable */
import { Logger } from "@nestjs/common";
import { PrismaService } from "./prisma.service";

describe("PrismaService", () => {
  const originalDatabaseUrl = process.env.DATABASE_URL;
  const fallbackDatabaseUrl =
    originalDatabaseUrl ?? "postgresql://user:pass@localhost:5432/test";

  beforeAll(() => {
    process.env.DATABASE_URL = fallbackDatabaseUrl;
  });

  afterAll(() => {
    if (originalDatabaseUrl) {
      process.env.DATABASE_URL = originalDatabaseUrl;
    } else {
      delete process.env.DATABASE_URL;
    }
  });

  const silenceLogger = () => {
    jest.spyOn(Logger.prototype, "log").mockImplementation(() => {});
    jest.spyOn(Logger.prototype, "warn").mockImplementation(() => {});
    jest.spyOn(Logger.prototype, "error").mockImplementation(() => {});
  };

  const createService = () => {
    const service = new PrismaService();
    service.$connect = jest.fn().mockResolvedValue() as any;
    service.$disconnect = jest.fn().mockResolvedValue() as any;
    service.$queryRaw = jest.fn().mockResolvedValue() as any;
    return service;
  };

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("connects to the database on module init", async () => {
    silenceLogger();
    const service = createService();

    await service.onModuleInit();

    expect(service.$connect).toHaveBeenCalledTimes(1);
  });

  it("retries connection attempts until success", async () => {
    silenceLogger();
    const service = createService();

    const connectMock = jest
      .fn()
      .mockRejectedValueOnce(new Error("fail-1"))
      .mockRejectedValueOnce(new Error("fail-2"))
      .mockResolvedValue();

    service.$connect = connectMock as any;

    const delaySpy = jest.spyOn(service as any, "delay").mockResolvedValue();

    await service.onModuleInit();

    expect(connectMock).toHaveBeenCalledTimes(3);
    expect(delaySpy).toHaveBeenCalledTimes(2);
  });

  it("throws after exceeding maximum retries", async () => {
    silenceLogger();
    const service = createService();
    const failure = new Error("permanent failure");

    service.$connect = jest.fn().mockRejectedValue(failure) as any;

    jest.spyOn(service as any, "delay").mockResolvedValue();

    await expect(service.onModuleInit()).rejects.toThrow(
      "Failed to connect to database after maximum retries",
    );
    expect(service.$connect).toHaveBeenCalledTimes(5);
  });

  it("disconnects on module destroy", async () => {
    const service = createService();

    await service.onModuleDestroy();

    expect(service.$disconnect).toHaveBeenCalledTimes(1);
  });

  it("returns true when the health check query succeeds", async () => {
    const service = createService();
    const result = await service.isHealthy();

    expect(result).toBe(true);
    expect(service.$queryRaw).toHaveBeenCalledTimes(1);
  });

  it("returns false when the health check query fails", async () => {
    silenceLogger();
    const service = createService();
    const error = new Error("health failure");

    service.$queryRaw = jest.fn().mockRejectedValue(error) as any;

    const result = await service.isHealthy();

    expect(result).toBe(false);
  });

  it("reconnects by disconnecting first and rethrowing on failure", async () => {
    silenceLogger();
    const service = createService();

    await service.reconnect();

    expect(service.$disconnect).toHaveBeenCalledTimes(1);
    expect(service.$connect).toHaveBeenCalledTimes(1);
  });

  it("propagates errors when reconnection fails", async () => {
    silenceLogger();
    const service = createService();

    const failure = new Error("cannot reconnect");
    service.$connect = jest.fn().mockRejectedValue(failure) as any;

    await expect(service.reconnect()).rejects.toBe(failure);
    expect(service.$disconnect).toHaveBeenCalledTimes(1);
  });

  it("delays for the specified duration", async () => {
    const service = createService();

    jest.useFakeTimers();
    try {
      const delayPromise = (service as any).delay(1000);

      jest.advanceTimersByTime(1000);
      await expect(delayPromise).resolves.toBeUndefined();
    } finally {
      jest.useRealTimers();
    }
  });
});
