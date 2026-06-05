const scan = jest.fn();
const get = jest.fn();
jest.mock("./redis.connection", () => ({
  createRedisConnection: () => ({ scan, get, quit: jest.fn() }),
}));

import { JobWorkerConnectionService } from "./job-worker-connection.service";

describe("JobWorkerConnectionService.getAllWorkerHeartbeats", () => {
  let service: JobWorkerConnectionService;
  beforeEach(() => {
    jest.clearAllMocks();
    service = new JobWorkerConnectionService();
  });

  it("scans, parses, and skips unparseable heartbeats", async () => {
    scan.mockResolvedValueOnce(["0", ["k1", "k2"]]);
    get.mockResolvedValueOnce(
      JSON.stringify({
        instanceId: "a",
        hostname: "h",
        startedAt: "2026-06-03T00:00:00Z",
      }),
    );
    get.mockResolvedValueOnce("not-json");
    const result = await service.getAllWorkerHeartbeats();
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ instanceId: "a", hostname: "h" });
  });
});
