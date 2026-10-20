import { join } from "node:path";
import { Worker } from "node:worker_threads";
import { describeError, logger } from "./log";
import type { Conversion, Model, Snapshot } from "./types";

// Worker failures that depend on load rather than content; worth another attempt.
export const TRANSIENT_PARSER_REASONS = new Set([
  "parser-timeout",
  "parser-exited",
  "parser-failed",
]);

function convertOnce(
  model: Model,
  snapshot: Snapshot,
  origin: string,
): Promise<Conversion> {
  return new Promise((resolve) => {
    const worker = new Worker(join(__dirname, "worker.js"), {
      workerData: { model: model.name, snapshot, origin },
      resourceLimits: { maxOldGenerationSizeMb: 256, stackSizeMb: 4 },
    });
    let finished = false;
    const finish = (result: Conversion) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      void worker.terminate();
      resolve(result);
    };
    const failure = (reason: string) =>
      finish({
        state: "quarantined",
        before: snapshot.values,
        after: snapshot.values,
        rules: [],
        reason,
      });
    const timer = setTimeout(() => failure("parser-timeout"), 10_000);
    worker.once("message", (result: Conversion) => finish(result));
    worker.once("error", (error) => {
      logger.warn("parser worker failed", {
        model: model.name,
        error: describeError(error),
      });
      failure("parser-failed");
    });
    worker.once("exit", (code) => {
      if (!finished)
        logger.warn("parser worker exited early", { model: model.name, code });
      if (!finished) failure("parser-exited");
    });
  });
}

export async function isolatedConvert(
  model: Model,
  snapshot: Snapshot,
  origin: string,
): Promise<Conversion> {
  const first = await convertOnce(model, snapshot, origin);
  if (!first.reason || !TRANSIENT_PARSER_REASONS.has(first.reason))
    return first;
  logger.warn("retrying parser in a fresh worker", {
    model: model.name,
    reason: first.reason,
  });
  return convertOnce(model, snapshot, origin);
}
