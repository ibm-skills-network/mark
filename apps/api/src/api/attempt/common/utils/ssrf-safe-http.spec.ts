import axios from "axios";
import {
  assertFetchableUrl,
  BlockedUrlError,
  isBlockedAddress,
  safeGet,
} from "./ssrf-safe-http";

/** An axios failure carrying an HTTP response. */
function responseError(status: number, headers: Record<string, string> = {}) {
  return Object.assign(new Error(`Request failed with status code ${status}`), {
    isAxiosError: true,
    response: { status, headers, data: "" },
  });
}

/** A transport-level axios failure: no response, just a code. */
function networkError(code: string) {
  return Object.assign(new Error(`network failure: ${code}`), {
    isAxiosError: true,
    code,
  });
}

/** What the service mesh returns when cluster egress refuses the connect. */
const meshConnectRefused = () =>
  responseError(504, {
    "l5d-proxy-error": "endpoint 93.184.216.34:80: client error (Connect)",
  });

describe("ssrf-safe-http", () => {
  describe("isBlockedAddress", () => {
    it.each([
      "127.0.0.1",
      "0.0.0.0",
      "10.0.0.1",
      "172.16.5.4",
      "172.31.255.255",
      "192.168.1.1",
      "169.254.169.254", // cloud metadata
      "100.64.0.1", // CGNAT
      "::1",
      "fc00::1",
      "fe80::1",
      "::ffff:127.0.0.1", // IPv4-mapped IPv6
      "not-an-ip",
    ])("blocks %s", (ip) => {
      expect(isBlockedAddress(ip)).toBe(true);
    });

    it.each(["8.8.8.8", "1.1.1.1", "93.184.216.34", "2606:4700:4700::1111"])(
      "allows public address %s",
      (ip) => {
        expect(isBlockedAddress(ip)).toBe(false);
      },
    );
  });

  describe("assertFetchableUrl", () => {
    it.each([
      "ftp://example.com/x",
      "file:///etc/passwd",
      "gopher://example.com",
      "http://127.0.0.1/",
      "https://169.254.169.254/latest/meta-data/",
      "http://[::1]/",
      "not a url",
    ])("rejects %s", (url) => {
      expect(() => assertFetchableUrl(url)).toThrow(BlockedUrlError);
    });

    it.each(["https://example.com/path?q=1", "http://93.184.216.34/page"])(
      "allows %s",
      (url) => {
        expect(() => assertFetchableUrl(url)).not.toThrow();
      },
    );
  });

  describe("safeGet scheme upgrade", () => {
    const getSpy = jest.spyOn(axios, "get");

    afterEach(() => {
      getSpy.mockReset();
    });

    afterAll(() => {
      getSpy.mockRestore();
    });

    const requestedUrls = () => getSpy.mock.calls.map(([url]) => url);

    it("fetches an http:// URL over https first and returns that response", async () => {
      getSpy.mockResolvedValueOnce({ status: 200, data: "ok" });

      const response = await safeGet("http://example.com/page?q=1");

      expect(response.data).toBe("ok");
      expect(requestedUrls()).toEqual(["https://example.com/page?q=1"]);
    });

    it("leaves an https:// URL untouched", async () => {
      getSpy.mockResolvedValueOnce({ status: 200, data: "ok" });

      await safeGet("https://example.com/page");

      expect(requestedUrls()).toEqual(["https://example.com/page"]);
    });

    it("does not upgrade an http:// URL on an explicit non-default port", async () => {
      getSpy.mockResolvedValueOnce({ status: 200, data: "ok" });

      await safeGet("http://example.com:8080/page");

      expect(requestedUrls()).toEqual(["http://example.com:8080/page"]);
    });

    it("falls back to the original http:// URL when the host does not speak https", async () => {
      getSpy
        .mockRejectedValueOnce(networkError("EPROTO"))
        .mockResolvedValueOnce({ status: 200, data: "plain" });

      const response = await safeGet("http://example.com/page");

      expect(response.data).toBe("plain");
      expect(requestedUrls()).toEqual([
        "https://example.com/page",
        "http://example.com/page",
      ]);
    });

    it("does not fall back when the https server answered with an HTTP error", async () => {
      const notFound = responseError(404);
      getSpy.mockRejectedValueOnce(notFound);

      await expect(safeGet("http://example.com/missing")).rejects.toBe(
        notFound,
      );
      expect(requestedUrls()).toEqual(["https://example.com/missing"]);
    });

    it("does not fall back when the host does not resolve", async () => {
      const notFound = networkError("ENOTFOUND");
      getSpy.mockRejectedValueOnce(notFound);

      await expect(safeGet("http://nope.invalid/")).rejects.toBe(notFound);
      expect(getSpy).toHaveBeenCalledTimes(1);
    });

    it("does not fall back when the connection guard refused the address", async () => {
      const refused = networkError("ERR_BLOCKED_ADDRESS");
      getSpy.mockRejectedValueOnce(refused);

      await expect(safeGet("http://internal.example.com/")).rejects.toBe(
        refused,
      );
      expect(getSpy).toHaveBeenCalledTimes(1);
    });

    it("surfaces the https failure when the http fallback is refused by cluster egress", async () => {
      const tlsFailure = networkError("EPROTO");
      getSpy
        .mockRejectedValueOnce(tlsFailure)
        .mockRejectedValueOnce(meshConnectRefused());

      await expect(safeGet("http://example.com/")).rejects.toBe(tlsFailure);
    });

    it("surfaces the http failure when the origin itself answered over http", async () => {
      const httpNotFound = responseError(404);
      getSpy
        .mockRejectedValueOnce(networkError("ECONNREFUSED"))
        .mockRejectedValueOnce(httpNotFound);

      await expect(safeGet("http://example.com/")).rejects.toBe(httpNotFound);
    });

    it("rejects an internal http:// literal before any request is made", async () => {
      await expect(safeGet("http://127.0.0.1/")).rejects.toBeInstanceOf(
        BlockedUrlError,
      );
      expect(getSpy).not.toHaveBeenCalled();
    });

    it("applies the security limits to both the upgraded and the fallback request", async () => {
      getSpy
        .mockRejectedValueOnce(networkError("EPROTO"))
        .mockResolvedValueOnce({ status: 200, data: "plain" });

      await safeGet("http://example.com/", {
        maxRedirects: 50,
        proxy: { host: "evil.example.com", port: 1 },
      });

      for (const [, config] of getSpy.mock.calls) {
        expect(config).toMatchObject({
          timeout: 10_000,
          maxRedirects: 5,
          proxy: false,
        });
        expect(config?.httpAgent).toBeDefined();
        expect(config?.httpsAgent).toBeDefined();
      }
    });
  });
});
