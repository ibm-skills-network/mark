import { EventEmitter } from "node:events";
import { registerProcessSafetyHandlers } from "./process-safety";

function mockLogger() {
  return { error: jest.fn() };
}

describe("registerProcessSafetyHandlers", () => {
  it("logs an unhandledRejection with context and does not rethrow (worker survives)", () => {
    const logger = mockLogger();
    const target = new EventEmitter();
    registerProcessSafetyHandlers(logger, target);

    expect(() =>
      target.emit(
        "unhandledRejection",
        new Error("Image or Canvas expected"),
        Promise.resolve(),
      ),
    ).not.toThrow();

    expect(logger.error).toHaveBeenCalledTimes(1);
    const message = logger.error.mock.calls[0][0] as string;
    expect(message).toMatch(/unhandledRejection/i);
    expect(message).toContain("Image or Canvas expected");
  });

  it("logs an uncaughtException with context and does not rethrow", () => {
    const logger = mockLogger();
    const target = new EventEmitter();
    registerProcessSafetyHandlers(logger, target);

    expect(() =>
      target.emit("uncaughtException", new Error("boom-sync")),
    ).not.toThrow();

    expect(logger.error).toHaveBeenCalledTimes(1);
    const message = logger.error.mock.calls[0][0] as string;
    expect(message).toMatch(/uncaughtException/i);
    expect(message).toContain("boom-sync");
  });

  it("handles a non-Error rejection reason without throwing", () => {
    const logger = mockLogger();
    const target = new EventEmitter();
    registerProcessSafetyHandlers(logger, target);

    expect(() =>
      target.emit("unhandledRejection", "string reason", Promise.resolve()),
    ).not.toThrow();

    expect(logger.error).toHaveBeenCalledTimes(1);
    expect(logger.error.mock.calls[0][0] as string).toContain("string reason");
  });

  it("registers exactly one listener per event on the target", () => {
    const logger = mockLogger();
    const target = new EventEmitter();
    registerProcessSafetyHandlers(logger, target);

    expect(target.listenerCount("unhandledRejection")).toBe(1);
    expect(target.listenerCount("uncaughtException")).toBe(1);
  });
});
