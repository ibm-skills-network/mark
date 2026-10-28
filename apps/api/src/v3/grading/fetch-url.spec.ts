import {
  FETCH_MAX_BYTES,
  type FetchResponse,
  fetchUrlAsParts,
  type FetchUrlDeps,
  guardedFetch,
} from "./fetch-url";
import { UnreadableSourceError } from "./materialize";

function response(
  status: number,
  body = "",
  headers: Record<string, string> = {},
): FetchResponse {
  return { status, headers, body: Buffer.from(body) };
}

function deps(
  dns: Record<string, string[]>,
  routes: Record<string, FetchResponse>,
): FetchUrlDeps & { requested: string[] } {
  const requested: string[] = [];
  return {
    requested,
    resolveHost: jest.fn((host: string) => {
      const addresses = dns[host];
      return addresses
        ? Promise.resolve(addresses)
        : Promise.reject(new Error("ENOTFOUND"));
    }),
    request: jest.fn((url: URL) => {
      requested.push(url.href);
      const routed = routes[url.href];
      return routed
        ? Promise.resolve(routed)
        : Promise.reject(new Error(`unrouted ${url.href}`));
    }),
  };
}

describe("guardedFetch", () => {
  it("rejects non-http schemes without a request", async () => {
    const fake = deps({}, {});
    for (const url of [
      "file:///etc/passwd",
      "gopher://example.com/",
      "ftp://example.com/x",
    ]) {
      await expect(guardedFetch(url, fake)).rejects.toThrow();
    }
    expect(fake.requested).toEqual([]);
  });

  it.each([
    ["http://127.0.0.1/", "loopback literal"],
    ["http://169.254.169.254/latest/meta-data/", "metadata literal"],
    ["http://[::1]/", "ipv6 loopback"],
    ["http://10.1.2.3/", "private literal"],
  ])("rejects %s (%s) without a request", async (url) => {
    const fake = deps({}, {});
    await expect(guardedFetch(url, fake)).rejects.toThrow();
    expect(fake.requested).toEqual([]);
  });

  it("rejects a hostname that resolves to a private address", async () => {
    const fake = deps(
      { "internal.example.com": ["93.184.216.34", "192.168.1.5"] },
      {},
    );
    await expect(
      guardedFetch("https://internal.example.com/", fake),
    ).rejects.toThrow(/non-public/);
    expect(fake.requested).toEqual([]);
  });

  it("rejects a redirect to a private address", async () => {
    const fake = deps(
      {
        "public.example.com": ["93.184.216.34"],
        "sneaky.example.com": ["10.0.0.7"],
      },
      {
        "https://public.example.com/": response(302, "", {
          location: "https://sneaky.example.com/admin",
        }),
      },
    );
    await expect(
      guardedFetch("https://public.example.com/", fake),
    ).rejects.toThrow(/non-public/);
    expect(fake.requested).toEqual(["https://public.example.com/"]);
  });

  it("rejects a redirect to the metadata address literal", async () => {
    const fake = deps(
      { "public.example.com": ["93.184.216.34"] },
      {
        "https://public.example.com/": response(301, "", {
          location: "http://169.254.169.254/latest/",
        }),
      },
    );
    await expect(
      guardedFetch("https://public.example.com/", fake),
    ).rejects.toThrow();
    expect(fake.requested).toHaveLength(1);
  });

  it("follows at most 3 redirects", async () => {
    const dns = { "a.example.com": ["93.184.216.34"] };
    const routes: Record<string, FetchResponse> = {};
    for (let index = 0; index < 5; index += 1) {
      routes[`https://a.example.com/${index}`] = response(302, "", {
        location: `/${index + 1}`,
      });
    }
    const fake = deps(dns, routes);
    await expect(guardedFetch("https://a.example.com/0", fake)).rejects.toThrow(
      /more than 3 times/,
    );
    expect(fake.requested).toHaveLength(4);
  });

  it("refuses a body over the size cap", async () => {
    const fake = deps(
      { "a.example.com": ["93.184.216.34"] },
      {
        "https://a.example.com/": {
          status: 200,
          headers: {},
          body: Buffer.alloc(FETCH_MAX_BYTES + 1),
        },
      },
    );
    await expect(guardedFetch("https://a.example.com/", fake)).rejects.toThrow(
      /larger than/,
    );
  });
});

describe("fetchUrlAsParts", () => {
  it("reads a GitHub blob link as the raw file", async () => {
    const fake = deps(
      { "raw.githubusercontent.com": ["185.199.108.133"] },
      {
        "https://raw.githubusercontent.com/me/repo/main/src/app.py": response(
          200,
          "print('hi')",
          {
            "content-type": "text/plain; charset=utf-8",
          },
        ),
      },
    );
    const parts = await fetchUrlAsParts(
      "https://github.com/me/repo/blob/main/src/app.py",
      fake,
    );
    expect(parts).toEqual([
      expect.objectContaining({
        name: "https://github.com/me/repo/blob/main/src/app.py",
        kind: "text",
        text: "print('hi')",
      }),
    ]);
  });

  it("turns an HTML page into readable text without scripts", async () => {
    const fake = deps(
      { "blog.example.com": ["93.184.216.34"] },
      {
        "https://blog.example.com/post": response(
          200,
          "<html><head><script>steal()</script><style>p{}</style></head><body><h1>My post</h1><p>Hello &amp; welcome</p></body></html>",
          { "content-type": "text/html" },
        ),
      },
    );
    const [part] = await fetchUrlAsParts("https://blog.example.com/post", fake);
    expect(part.text).toContain("My post");
    expect(part.text).toContain("Hello & welcome");
    expect(part.text).not.toContain("steal()");
  });

  async function unreadable(promise: Promise<unknown>) {
    try {
      await promise;
    } catch (error) {
      if (error instanceof UnreadableSourceError) return error.source;
      throw error;
    }
    throw new Error("expected the link to be unreadable");
  }

  const host = { "a.example.com": ["93.184.216.34"] };

  it("refuses a blocked link without grading it, and logs only the host", async () => {
    const warn = jest.fn();
    const source = await unreadable(
      fetchUrlAsParts("http://127.0.0.1:8080/secret", deps({}, {}), {
        debug: jest.fn(),
        info: jest.fn(),
        warn,
        error: jest.fn(),
      }),
    );
    expect(source).toEqual(
      expect.objectContaining({
        kind: "url",
        code: "url_blocked",
        retryable: false,
      }),
    );
    expect(warn).toHaveBeenCalledWith(
      "grading.v3.url_fetch_failed",
      expect.objectContaining({ host: "127.0.0.1", code: "url_blocked" }),
    );
  });

  it.each([
    [404, "url_unreachable", false],
    [403, "url_unreachable", false],
    [410, "url_unreachable", false],
    [429, "url_temporarily_unavailable", true],
    [503, "url_temporarily_unavailable", true],
  ])("maps HTTP %i to %s (retryable %s)", async (status, code, retryable) => {
    const fake = deps(host, { "https://a.example.com/x": response(status) });
    expect(
      await unreadable(fetchUrlAsParts("https://a.example.com/x", fake)),
    ).toEqual({
      kind: "url",
      code,
      retryable,
      name: "https://a.example.com/x",
      httpStatus: status,
    });
  });

  it("retries a link that timed out", async () => {
    const fake = deps(host, {});
    fake.request = jest.fn(() =>
      Promise.reject(
        Object.assign(new Error("timeout"), { code: "ECONNABORTED" }),
      ),
    );
    expect(
      await unreadable(fetchUrlAsParts("https://a.example.com/x", fake)),
    ).toEqual(
      expect.objectContaining({
        code: "url_temporarily_unavailable",
        retryable: true,
      }),
    );
  });

  it("does not retry a host that does not exist", async () => {
    expect(
      await unreadable(
        fetchUrlAsParts("https://nowhere.example.com/x", deps({}, {})),
      ),
    ).toEqual(
      expect.objectContaining({ code: "url_unreachable", retryable: false }),
    );
  });

  it("refuses an empty page and a binary download", async () => {
    const fake = deps(host, {
      "https://a.example.com/empty": response(200, "  ", {
        "content-type": "text/plain",
      }),
      "https://a.example.com/blob": response(200, "\u0000\u0001\u0002", {
        "content-type": "application/octet-stream",
      }),
    });
    expect(
      await unreadable(fetchUrlAsParts("https://a.example.com/empty", fake)),
    ).toEqual(expect.objectContaining({ code: "url_empty", retryable: false }));
    expect(
      await unreadable(fetchUrlAsParts("https://a.example.com/blob", fake)),
    ).toEqual(
      expect.objectContaining({ code: "url_unsupported", retryable: false }),
    );
  });
});
