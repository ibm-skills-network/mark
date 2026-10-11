import { JOB_NAMES, JOB_QUEUE_NAMES } from "./job-queue.constants";

describe("job-queue.constants", () => {
  it("defines the file-extract queue and job names", () => {
    expect(JOB_QUEUE_NAMES.FILE_EXTRACT).toBe("mark.file-extract");
    expect(JOB_NAMES.FILE_EXTRACT).toBe("file.extract");
  });
});
