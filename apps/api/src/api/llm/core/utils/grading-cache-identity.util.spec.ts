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
      "gpt-5.6-luna@2026-09-22-complete-text-and-rubric:rollout-42",
    );
  });
});

it("does not let a stale deployment override reuse pre-fix grades", () => {
  const old = process.env.GRADING_CACHE_REVISION;
  try {
    process.env.GRADING_CACHE_REVISION = "2026-08-05-gpt56";
    expect(getGradingModelCacheIdentity("gpt-5.6-luna")).not.toBe(
      "gpt-5.6-luna@2026-08-05-gpt56",
    );
    expect(getGradingModelCacheIdentity("gpt-5.6-luna")).toContain(
      "2026-09-22-complete-text-and-rubric",
    );
  } finally {
    if (old === undefined) delete process.env.GRADING_CACHE_REVISION;
    else process.env.GRADING_CACHE_REVISION = old;
  }
});
