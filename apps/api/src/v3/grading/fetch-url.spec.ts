import {
  FETCH_MAX_BYTES,
  type FetchResponse,
  fetchUrlAsParts,
  type FetchUrlDeps,
  guardedFetch,
} from "./fetch-url";

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

  it("returns a part saying why when the link is refused", async () => {
    const warn = jest.fn();
    const parts = await fetchUrlAsParts(
      "http://127.0.0.1:8080/secret",
      deps({}, {}),
      {
        debug: jest.fn(),
        info: jest.fn(),
        warn,
        error: jest.fn(),
      },
    );
    expect(parts).toHaveLength(1);
    expect(parts[0].text).toMatch(/could not read .*not allowed/);
    expect(warn).toHaveBeenCalledWith(
      "grading.v3.url_fetch_failed",
      expect.objectContaining({ host: "127.0.0.1" }),
    );
  });

  it("returns a part saying why on an HTTP error", async () => {
    const fake = deps(
      { "a.example.com": ["93.184.216.34"] },
      { "https://a.example.com/gone": response(404) },
    );
    const [part] = await fetchUrlAsParts("https://a.example.com/gone", fake);
    expect(part.text).toContain("HTTP 404");
  });
});
