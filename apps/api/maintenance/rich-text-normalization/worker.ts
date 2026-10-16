import { parentPort, workerData } from "node:worker_threads";
import { convert } from "./converter";
import { modelByName } from "./manifest";
import type { Snapshot } from "./types";

const data = workerData as {
  model: string;
  snapshot: Snapshot;
  origin: string;
};
parentPort?.postMessage(
  convert(modelByName(data.model), data.snapshot, data.origin),
);
