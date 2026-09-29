import {
  clearRequestLog,
  installRequestLog,
  recentRequests,
} from "../request-log";

const respond = (status: number, requestId?: string) =>
  ({
    status,
    headers: new Headers(requestId ? { "x-request-id": requestId } : {}),
  }) as Response;

describe("request log", () => {
  let uninstall: () => void;
  let inner: jest.Mock;

  beforeEach(() => {
    clearRequestLog();
    inner = jest.fn();
    window.fetch = inner as unknown as typeof fetch;
    uninstall = installRequestLog();
  });
  afterEach(() => uninstall());

  it("records method, path, status and request id of an API call", async () => {
    inner.mockResolvedValue(respond(504, "abc123"));

    await window.fetch("/api/v2/assignments/1/attempts/2?lang=es", {
      method: "PATCH",
      body: JSON.stringify({ learnerTextResponse: "my answer" }),
    });

    expect(recentRequests()).toEqual([
      expect.objectContaining({
        method: "PATCH",
        path: "/api/v2/assignments/1/attempts/2",
        status: 504,
        requestId: "abc123",
      }),
    ]);
    // Nothing a learner typed, and no query string, is ever kept.
    expect(JSON.stringify(recentRequests())).not.toContain("my answer");
    expect(JSON.stringify(recentRequests())).not.toContain("lang=es");
  });

  it("records a request that never got a response, and still rejects", async () => {
    inner.mockRejectedValue(new TypeError("Failed to fetch"));

    await expect(window.fetch("/api/v1/user-session")).rejects.toThrow(
      "Failed to fetch",
    );

    expect(recentRequests()[0]).toMatchObject({
      method: "GET",
      path: "/api/v1/user-session",
      status: null,
    });
  });

  it("returns the real response untouched", async () => {
    const response = respond(200);
    inner.mockResolvedValue(response);

    await expect(window.fetch("/api/v1/ai-status")).resolves.toBe(response);
  });

  it("ignores calls that are not to our API", async () => {
    inner.mockResolvedValue(respond(200));

    await window.fetch("https://api.github.com/user");
    await window.fetch("/_next/static/chunk.js");

    expect(recentRequests()).toEqual([]);
  });

  it("keeps only the most recent twenty", async () => {
    inner.mockResolvedValue(respond(200));

    for (let index = 0; index < 25; index++) {
      await window.fetch(`/api/v1/thing/${index}`);
    }

    const kept = recentRequests();
    expect(kept).toHaveLength(20);
    expect(kept[0].path).toBe("/api/v1/thing/5");
    expect(kept[19].path).toBe("/api/v1/thing/24");
  });

  it("installs once and restores the original fetch on uninstall", () => {
    const second = installRequestLog();
    second();
    uninstall();

    expect(window.fetch).toBe(inner);
  });
});
