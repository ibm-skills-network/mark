import { lookup as dnsLookup, type LookupAddress } from "node:dns";
import { Agent as HttpAgent } from "node:http";
import { Agent as HttpsAgent } from "node:https";
import { BlockList, isIP, isIPv4, type LookupFunction } from "node:net";
import axios, { type AxiosRequestConfig, type AxiosResponse } from "axios";

/**
 * SSRF-safe HTTP fetching for learner-supplied URLs.
 *
 * Learners submit arbitrary URLs that the grader fetches server-side. Without
 * a guard, a submission could point the server at loopback, the cloud metadata
 * endpoint (169.254.169.254), or other internal-only hosts. The protections
 * here are:
 *
 *  1. scheme allow-list (http/https only) — rejects file:, gopher:, etc.
 *  2. a connection-time DNS guard installed on the HTTP agents that refuses to
 *     open a socket to any non-public address. Because it runs per socket, it
 *     also covers redirect hops and DNS-rebinding (every connection is
 *     re-resolved and re-checked), which a one-shot pre-flight cannot.
 */

const blockedAddresses = new BlockList();

// Non-routable / internal IPv4 ranges (RFC 1918, loopback, link-local incl.
// the cloud metadata address, CGNAT, documentation, multicast, reserved).
const IPV4_BLOCKS: ReadonlyArray<readonly [string, number]> = [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
];
for (const [network, prefix] of IPV4_BLOCKS) {
  blockedAddresses.addSubnet(network, prefix, "ipv4");
}

// Unspecified, loopback, unique-local, link-local, multicast IPv6.
const IPV6_BLOCKS: ReadonlyArray<readonly [string, number]> = [
  ["::", 128],
  ["::1", 128],
  ["fc00::", 7],
  ["fe80::", 10],
  ["ff00::", 8],
];
for (const [network, prefix] of IPV6_BLOCKS) {
  blockedAddresses.addSubnet(network, prefix, "ipv6");
}

/** True when an IP literal must not be the target of an outbound fetch. */
export function isBlockedAddress(ip: string): boolean {
  if (!isIP(ip)) {
    return true;
  }
  // Unwrap IPv4-mapped IPv6 (e.g. ::ffff:169.254.169.254) and check the v4.
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(ip);
  const address = mapped ? mapped[1] : ip;
  return blockedAddresses.check(address, isIPv4(address) ? "ipv4" : "ipv6");
}

const guardedLookup = ((hostname, options, callback) => {
  dnsLookup(
    hostname,
    options,
    (
      error: NodeJS.ErrnoException | null,
      address: string | LookupAddress[],
      family?: number,
    ) => {
      if (error) {
        callback(error, address, family);
        return;
      }
      // dnsLookup mirrors the options it was handed: an array of addresses when
      // called with { all: true } — which Node's default autoSelectFamily /
      // happy-eyeballs path does — and a single address otherwise. Re-check
      // every resolved address, then hand the result back in the SAME shape the
      // socket layer asked for. Collapsing the array to a single string breaks
      // the autoSelectFamily contract and fails every connection.
      const resolved = Array.isArray(address)
        ? address
        : [{ address, family: family ?? 0 }];
      if (resolved.some((entry) => isBlockedAddress(entry.address))) {
        callback(
          Object.assign(
            new Error("Refused to connect to a non-public address"),
            { code: "ERR_BLOCKED_ADDRESS" },
          ),
          address,
          family,
        );
        return;
      }
      callback(null, address, family);
    },
  );
}) as LookupFunction;

const httpAgent = new HttpAgent({ lookup: guardedLookup });
const httpsAgent = new HttpsAgent({ lookup: guardedLookup });

/** Raised when a URL is rejected before any request is made. */
export class BlockedUrlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BlockedUrlError";
  }
}

/**
 * Reject unsupported schemes and obvious internal IP literals up front. The
 * agent guard still re-checks at connection time (and covers hostnames /
 * redirects), so this is a fast pre-flight rather than the only line of
 * defence.
 */
export function assertFetchableUrl(rawUrl: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new BlockedUrlError("Invalid URL");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new BlockedUrlError("Only http(s) URLs may be fetched");
  }
  const host = parsed.hostname.replace(/^\[/, "").replace(/]$/, "");
  if (isIP(host) && isBlockedAddress(host)) {
    throw new BlockedUrlError("Refused to fetch a non-public address");
  }
  return parsed;
}

/**
 * Drop-in replacement for `axios.get` for learner-supplied URLs: enforces the
 * SSRF guard and applies sane timeout / size / redirect bounds.
 */
export async function safeGet<T = unknown>(
  url: string,
  config: AxiosRequestConfig = {},
): Promise<AxiosResponse<T>> {
  assertFetchableUrl(url);
  return axios.get<T>(url, {
    ...config,
    // Security limits are applied last so callers cannot override them.
    timeout: 10_000,
    maxContentLength: 10 * 1024 * 1024,
    maxRedirects: 5,
    httpAgent,
    httpsAgent,
    // Never tunnel through an ambient HTTP(S)_PROXY: a proxy connects on our
    // behalf, so the guarded lookup would only vet the proxy's address and the
    // SSRF check would be silently bypassed.
    proxy: false,
  });
}
