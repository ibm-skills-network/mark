/**
 * @jest-environment jsdom
 *
 * Regression test for the drill-down "fetch failed" bug.
 *
 * Queue names contain dots ("mark.assignment.v2"). The browser fetch is proxied
 * by a same-origin Next.js rewrite ("/api/:path*"); a path segment with literal
 * dots is treated as file-like by that proxy and the request never forwards,
 * surfacing as a bare "fetch failed" at the transport layer (no HTTP status).
 *
 * The fix carries the queue name in a `?queue=` query value instead of a path
 * segment — query strings are not path-normalized, so the dotted name survives
 * the proxy opaquely. This test pins that behavior: the request path (before the
 * query string) must contain no dotted queue segment, and the queue name must be
 * forwarded as a `queue` query parameter.
 */
import {
  getQueueActiveJobs,
  getQueueFailedJobs,
  removeFailedJob,
  retryFailedJob,
} from "../../../../lib/shared";

describe("admin queues failed-jobs fetch (dotted queue name)", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: "OK",
      json: async () => ({ queueName: "mark.assignment.v2", failed: [] }),
    }) as unknown as typeof fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
    jest.clearAllMocks();
  });

  const requestedUrl = (): string => {
    const mock = global.fetch as jest.Mock;
    return String(mock.mock.calls[0]?.[0] ?? "");
  };

  const pathOf = (url: string): string => url.split("?")[0] ?? "";

  it("requests the failed endpoint with a dot-free path and the queue in the query", async () => {
    await getQueueFailedJobs("tok", "mark.assignment.v2", 25);
    const url = requestedUrl();
    expect(pathOf(url)).toContain("/queue-status/failed");
    // No dotted queue segment anywhere in the path portion.
    expect(pathOf(url).split("/queue-status/")[1]).not.toContain(".");
    expect(url).toContain("queue=mark.assignment.v2");
    expect(url).toContain("limit=25");
  });

  it("requests the active endpoint with a dot-free path and the queue in the query", async () => {
    await getQueueActiveJobs("tok", "mark.assignment.v2", 25);
    const url = requestedUrl();
    expect(pathOf(url)).toContain("/queue-status/active");
    expect(pathOf(url).split("/queue-status/")[1]).not.toContain(".");
    expect(url).toContain("queue=mark.assignment.v2");
  });

  it("retry/remove carry the queue in the query, never as a dotted path segment", async () => {
    await retryFailedJob("tok", "mark.assignment.v2", "42");
    let url = requestedUrl();
    expect(pathOf(url)).toContain("/queue-status/jobs/42/retry");
    expect(pathOf(url).split("/queue-status/")[1]).not.toContain(".");
    expect(url).toContain("queue=mark.assignment.v2");

    (global.fetch as jest.Mock).mockClear();
    await removeFailedJob("tok", "mark.assignment.v2", "42");
    url = requestedUrl();
    expect(pathOf(url)).toContain("/queue-status/jobs/42");
    expect(pathOf(url).split("/queue-status/")[1]).not.toContain(".");
    expect(url).toContain("queue=mark.assignment.v2");
  });

  it("forwards the x-admin-token header on the drill-down request", async () => {
    await getQueueFailedJobs("tok", "mark.assignment.v2", 25);
    const init = (global.fetch as jest.Mock).mock.calls[0]?.[1] as
      | RequestInit
      | undefined;
    const headers = (init?.headers ?? {}) as Record<string, string>;
    expect(headers["x-admin-token"]).toBe("tok");
  });
});
