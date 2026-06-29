import { PublicAuthThrottlerGuard } from "./public-auth-throttler.guard";

// Access the protected method via casting for unit testing
type GuardWithGetTracker = {
  getTracker(request: Record<string, unknown>): Promise<string>;
};

describe("PublicAuthThrottlerGuard.getTracker", () => {
  let guard: GuardWithGetTracker;

  beforeEach(() => {
    // Construct with no deps — we only test getTracker which has no DI requirements
    guard =
      new (PublicAuthThrottlerGuard as unknown as new () => GuardWithGetTracker)();
  });

  it("returns the first XFF hop when x-forwarded-for is a string", async () => {
    const request = {
      headers: { "x-forwarded-for": "1.2.3.4, 10.0.0.1, 172.16.0.1" },
      ip: "10.0.0.1",
    };
    expect(await guard.getTracker(request)).toBe("1.2.3.4");
  });

  it("returns the first XFF hop when x-forwarded-for is an array", async () => {
    const request = {
      headers: { "x-forwarded-for": ["5.6.7.8, 10.0.0.2"] },
      ip: "10.0.0.2",
    };
    expect(await guard.getTracker(request)).toBe("5.6.7.8");
  });

  it("falls back to req.ip when x-forwarded-for is absent", async () => {
    const request = { headers: {}, ip: "9.8.7.6" };
    expect(await guard.getTracker(request)).toBe("9.8.7.6");
  });

  it("returns empty string when both XFF and ip are absent", async () => {
    const request = { headers: {} };
    expect(await guard.getTracker(request)).toBe("");
  });
});
