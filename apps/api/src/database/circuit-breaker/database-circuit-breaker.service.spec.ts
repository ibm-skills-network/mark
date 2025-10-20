import {
  DatabaseCircuitBreakerService,
  CircuitState,
} from "./database-circuit-breaker.service";

describe("DatabaseCircuitBreakerService", () => {
  let service: DatabaseCircuitBreakerService;

  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date("2024-01-01T00:00:00Z"));
    service = new DatabaseCircuitBreakerService();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("executes an operation successfully while circuit is closed", async () => {
    const result = await service.execute(async () => "value");

    expect(result).toBe("value");
    expect(service.getState()).toBe(CircuitState.CLOSED);
    expect(service.getStats()).toMatchObject({
      failureCount: 0,
      successCount: 0,
    });
  });

  it("opens the circuit after reaching the failure threshold and blocks new executions", async () => {
    const failingOperation = jest.fn().mockRejectedValue(new Error("DB down"));

    for (let index = 0; index < 5; index++) {
      await expect(service.execute(failingOperation)).rejects.toThrow(
        "DB down",
      );
    }

    expect(service.getState()).toBe(CircuitState.OPEN);

    await expect(service.execute(async () => "value")).rejects.toThrow(
      "Circuit breaker is OPEN - database operations blocked",
    );
  });

  it("transitions from OPEN to HALF_OPEN and back to CLOSED after successive successes", async () => {
    const failingOperation = jest.fn().mockRejectedValue(new Error("DB down"));

    for (let index = 0; index < 5; index++) {
      await expect(service.execute(failingOperation)).rejects.toThrow(
        "DB down",
      );
    }

    expect(service.getState()).toBe(CircuitState.OPEN);

    jest.setSystemTime(new Date("2024-01-01T00:01:05Z"));

    await expect(service.execute(async () => "ok-1")).resolves.toBe("ok-1");
    expect(service.getState()).toBe(CircuitState.HALF_OPEN);

    await service.execute(async () => "ok-2");
    await service.execute(async () => "ok-3");

    expect(service.getState()).toBe(CircuitState.CLOSED);
    expect(service.getStats().successCount).toBe(0);
  });

  it("can be manually reset to closed state", () => {
    service.reset();

    expect(service.getState()).toBe(CircuitState.CLOSED);
    expect(service.getStats()).toMatchObject({
      failureCount: 0,
      successCount: 0,
      lastFailureTime: undefined,
    });
  });
});
