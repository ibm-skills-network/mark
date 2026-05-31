import type { LoggerService } from "@nestjs/common";

/**
 * Process-level safety net for the gateway.
 *
 * The optional NATS messaging client (sn-messaging-ts-client) opens a ts-nats
 * connection per publish and never attaches an 'error' listener. A transient
 * DNS/socket failure (e.g. EAI_AGAIN resolving the NATS host) therefore
 * surfaces as an unhandled 'error' event — which cannot be caught with
 * try/catch (it is an EventEmitter 'error', not a rejected promise) — and would
 * crash the whole gateway. Messaging is non-critical (support tickets), so
 * connection-level NATS errors are swallowed here while every other uncaught
 * error still fails fast (preserving crash-and-restart for genuine faults).
 */
export function isNatsConnectionError(error: unknown): boolean {
  const candidate = error as {
    name?: string;
    code?: string;
    chainedError?: { code?: string };
  };
  return (
    candidate?.name === "NatsError" ||
    candidate?.code === "CONN_ERR" ||
    candidate?.chainedError?.code === "EAI_AGAIN"
  );
}

export function installProcessErrorGuard(logger: LoggerService): void {
  process.on("uncaughtException", (error: Error) => {
    if (isNatsConnectionError(error)) {
      logger.error(
        `Swallowed NATS connection error (messaging non-critical): ${error.message}`,
      );
      return;
    }
    // Winston flattens Error stacks; dump raw first so pod logs surface it.
    // eslint-disable-next-line no-console
    console.error("Uncaught exception (raw):", error);
    logger.error(`Uncaught exception: ${error.message}`, error.stack);
    // eslint-disable-next-line unicorn/no-process-exit
    process.exit(1);
  });
}
