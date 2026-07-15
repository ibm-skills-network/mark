import * as apiConstants from "src/job-queue/job-queue.constants";
import * as jobsConstants from "./job-queue.constants";

// The two constants files are hand-maintained duplicates (the jobs app cannot
// import across package roots at runtime). This spec fails the build the
// moment they drift — a queue added to one copy but not the other means the
// API enqueues to a queue no worker consumes.
describe("job-queue constants copies", () => {
  it("JOB_QUEUE_NAMES matches the apps/api copy", () => {
    expect(jobsConstants.JOB_QUEUE_NAMES).toEqual(apiConstants.JOB_QUEUE_NAMES);
  });

  it("JOB_NAMES matches the apps/api copy", () => {
    expect(jobsConstants.JOB_NAMES).toEqual(apiConstants.JOB_NAMES);
  });

  it("JOB_PRIORITIES matches the apps/api copy", () => {
    expect(jobsConstants.JOB_PRIORITIES).toEqual(apiConstants.JOB_PRIORITIES);
  });

  it("includes the heavy attempt queue", () => {
    expect(jobsConstants.JOB_QUEUE_NAMES.ATTEMPT_HEAVY).toBe(
      "mark.attempt.heavy",
    );
  });
});
