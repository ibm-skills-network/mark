import { JOB_QUEUE_NAMES } from "./job-queue.constants";
import { QUEUE_METADATA } from "./queue-metadata";

describe("QUEUE_METADATA coverage", () => {
  it("has an entry for every queue in JOB_QUEUE_NAMES", () => {
    for (const queueName of Object.values(JOB_QUEUE_NAMES)) {
      expect(QUEUE_METADATA[queueName]).toBeDefined();
    }
  });
});
