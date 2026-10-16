import { join } from "node:path";
import { Worker } from "node:worker_threads";
import type { Conversion, Model, Snapshot } from "./types";

export function isolatedConvert(
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
    worker.once("error", () => failure("parser-failed"));
    worker.once("exit", () => {
      if (!finished) failure("parser-exited");
    });
  });
}
