import {
  assertFetchableUrl,
  BlockedUrlError,
  isBlockedAddress,
} from "./ssrf-safe-http";

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
});
