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
 * The fix percent-encodes the dots so the drill-down path segment stays opaque
 * through the proxy. This test pins that behavior: the request URL for the
 * dotted queue must contain no literal dots in the queue-name segment, and the
 * status call (no dotted segment) keeps working unchanged.
 */
import {
  encodeQueueNameSegment,
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

  it("encodeQueueNameSegment escapes dots so no literal dot reaches the path", () => {
    const encoded = encodeQueueNameSegment("mark.assignment.v2");
    expect(encoded).toBe("mark%2Eassignment%2Ev2");
    expect(encoded).not.toContain(".");
  });

  it("requests the failed endpoint with a dot-free queue segment", async () => {
    await getQueueFailedJobs("tok", "mark.assignment.v2", 25);
    const url = requestedUrl();
    const segment = url.split("/queue-status/")[1]?.split("/failed")[0] ?? "";
    expect(segment).toBe("mark%2Eassignment%2Ev2");
    expect(segment).not.toContain(".");
    expect(url).toContain("limit=25");
  });

  it("requests the active endpoint with a dot-free queue segment", async () => {
    await getQueueActiveJobs("tok", "mark.assignment.v2", 25);
    const segment =
      requestedUrl().split("/queue-status/")[1]?.split("/active")[0] ?? "";
    expect(segment).not.toContain(".");
  });

  it("retry/remove also escape the dotted queue segment", async () => {
    await retryFailedJob("tok", "mark.assignment.v2", "42");
    expect(
      requestedUrl().split("/queue-status/")[1]?.split("/jobs")[0] ?? "",
    ).not.toContain(".");

    (global.fetch as jest.Mock).mockClear();
    await removeFailedJob("tok", "mark.assignment.v2", "42");
    expect(
      requestedUrl().split("/queue-status/")[1]?.split("/jobs")[0] ?? "",
    ).not.toContain(".");
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
