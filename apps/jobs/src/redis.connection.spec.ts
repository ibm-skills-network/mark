import * as apiConnection from "src/job-queue/redis.connection";
import * as jobsConnection from "./redis.connection";

// Producers (API) and consumers (jobs) must resolve Redis the same way, or a
// Sentinel failover would move the master for one side only.
describe("jobs redis.connection", () => {
  it("re-exports the API queue connection factory", () => {
    expect(jobsConnection.createRedisConnection).toBe(
      apiConnection.createRedisConnection,
    );
  });
});
