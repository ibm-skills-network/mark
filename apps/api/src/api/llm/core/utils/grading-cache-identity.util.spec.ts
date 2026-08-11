import { getGradingModelCacheIdentity } from "./grading-cache-identity.util";

describe("getGradingModelCacheIdentity", () => {
  const originalRevision = process.env.GRADING_CACHE_REVISION;

  afterEach(() => {
    if (originalRevision === undefined) {
      delete process.env.GRADING_CACHE_REVISION;
    } else {
      process.env.GRADING_CACHE_REVISION = originalRevision;
    }
  });

  it("keeps different assigned models in separate cache namespaces", () => {
    delete process.env.GRADING_CACHE_REVISION;

    expect(getGradingModelCacheIdentity("gpt-5.6-luna")).not.toBe(
      getGradingModelCacheIdentity("gpt-5.6-sol"),
    );
  });

  it("uses the deployment revision to invalidate rolling-model grades", () => {
    process.env.GRADING_CACHE_REVISION = "rollout-42";

    expect(getGradingModelCacheIdentity("gpt-5.6-luna")).toBe(
      "gpt-5.6-luna@rollout-42",
    );
  });
});
