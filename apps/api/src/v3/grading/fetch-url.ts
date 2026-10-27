import { lookup as dnsLookup, type LookupAddress } from "node:dns";
import { lookup as dnsLookupAsync } from "node:dns/promises";
import { Agent as HttpAgent } from "node:http";
import { Agent as HttpsAgent } from "node:https";
import { isIP, type LookupFunction } from "node:net";
import axios from "axios";
import { convertGitHubUrlToRaw } from "src/api/attempt/common/utils/github-content-fetch.util";
import { normalizeLearnerUrl } from "src/api/attempt/common/utils/learner-url.util";
import {
  assertFetchableUrl,
  BlockedUrlError,
  isBlockedAddress,
} from "src/api/attempt/common/utils/ssrf-safe-http";
import type { GradingLogger, Part } from "./contracts";
import { htmlToText } from "./html-text";
import {
  bytesToParts,
  couldNotReadPart,
  DEFAULT_MATERIALIZE_LIMITS,
  MaterializeLimitError,
} from "./materialize";

export const FETCH_MAX_REDIRECTS = 3;
export const FETCH_TIMEOUT_MS = 10_000;
export const FETCH_MAX_BYTES = 5 * 1024 * 1024;

export interface FetchResponse {
  status: number;
  headers: Record<string, string | undefined>;
  body: Buffer;
}

export interface FetchUrlDeps {
  /** Every address a hostname resolves to. */
  resolveHost(hostname: string): Promise<string[]>;
  /** One request, no redirect following, bounded by timeout and size. */
  request(
    url: URL,
    options: { timeoutMs: number; maxBytes: number },
  ): Promise<FetchResponse>;
}

/** Why a URL could not be read; becomes the text of the part. */
export class UrlFetchRefusedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UrlFetchRefusedError";
  }
}

// Connection-time guard as well as the pre-flight check: covers DNS answers
// that change between our lookup and the socket (rebinding).
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
      const resolved = Array.isArray(address)
        ? address
        : [{ address, family: family ?? 0 }];
      if (resolved.some((entry) => isBlockedAddress(entry.address))) {
        callback(
          Object.assign(
            new Error("Refused to connect to a non-public address"),
            {
              code: "ERR_BLOCKED_ADDRESS",
            },
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

export const defaultFetchUrlDeps: FetchUrlDeps = {
  async resolveHost(hostname) {
    const addresses = await dnsLookupAsync(hostname, { all: true });
    return addresses.map((entry) => entry.address);
  },
  async request(url, { timeoutMs, maxBytes }) {
    const response = await axios.get<ArrayBuffer>(url.href, {
      responseType: "arraybuffer",
      timeout: timeoutMs,
      maxContentLength: maxBytes,
      maxRedirects: 0,
      validateStatus: () => true,
      httpAgent,
      httpsAgent,
      proxy: false,
      headers: { "User-Agent": "mark-grader/3", Accept: "*/*" },
    });
    const headers: Record<string, string | undefined> = {};
    for (const [key, value] of Object.entries(response.headers)) {
      if (typeof value === "string") headers[key.toLowerCase()] = value;
    }
    return {
      status: response.status,
      headers,
      body: Buffer.from(response.data),
    };
  },
};

async function assertPublicTarget(url: URL, deps: FetchUrlDeps): Promise<void> {
  assertFetchableUrl(url.href);
  const host = url.hostname.replace(/^\[/, "").replace(/]$/, "");
  if (isIP(host)) return; // literal already checked by assertFetchableUrl
  let addresses: string[];
  try {
    addresses = await deps.resolveHost(host);
  } catch {
    throw new UrlFetchRefusedError(`the host ${host} could not be found`);
  }
  if (addresses.length === 0) {
    throw new UrlFetchRefusedError(`the host ${host} could not be found`);
  }
  if (addresses.some((address) => isBlockedAddress(address))) {
    throw new BlockedUrlError("Refused to fetch a non-public address");
  }
}

function describeFailure(error: unknown): string {
  if (error instanceof UrlFetchRefusedError) return error.message;
  if (error instanceof BlockedUrlError) return "the address is not allowed";
  const code = (error as { code?: unknown })?.code;
  if (code === "ECONNABORTED" || code === "ETIMEDOUT")
    return "the request timed out";
  if (code === "ERR_BLOCKED_ADDRESS") return "the address is not allowed";
  if (
    error instanceof Error &&
    /maxcontentlength|content length/i.test(error.message)
  ) {
    return `the response is larger than ${FETCH_MAX_BYTES} bytes`;
  }
  return "the request failed";
}

/** The final URL and body after following at most FETCH_MAX_REDIRECTS. */
export async function guardedFetch(
  rawUrl: string,
  deps: FetchUrlDeps = defaultFetchUrlDeps,
): Promise<{ url: URL; response: FetchResponse }> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new UrlFetchRefusedError("it is not a valid URL");
  }
  for (let hop = 0; hop <= FETCH_MAX_REDIRECTS; hop += 1) {
    await assertPublicTarget(url, deps);
    const response = await deps.request(url, {
      timeoutMs: FETCH_TIMEOUT_MS,
      maxBytes: FETCH_MAX_BYTES,
    });
    if (response.body.length > FETCH_MAX_BYTES) {
      throw new UrlFetchRefusedError(
        `the response is larger than ${FETCH_MAX_BYTES} bytes`,
      );
    }
    const location = response.headers.location;
    if (response.status >= 300 && response.status < 400 && location) {
      try {
        url = new URL(location, url);
      } catch {
        throw new UrlFetchRefusedError("it redirected to an invalid URL");
      }
      continue;
    }
    return { url, response };
  }
  throw new UrlFetchRefusedError(
    `it redirected more than ${FETCH_MAX_REDIRECTS} times`,
  );
}

function safeHost(url: string): string | undefined {
  try {
    return new URL(url).hostname;
  } catch {
    // Unparseable learner input has no host to log.
    return undefined;
  }
}

function partName(url: string): string {
  return url.length > 300 ? `${url.slice(0, 297)}...` : url;
}

/**
 * A learner URL as parts. GitHub blob links are read as the raw file; other
 * pages become readable text; PDFs and images go to the model natively.
 * Never throws for a bad link: the part says why it couldn't be read.
 */
export async function fetchUrlAsParts(
  rawUrl: string,
  deps: FetchUrlDeps = defaultFetchUrlDeps,
  logger?: GradingLogger,
): Promise<Part[]> {
  const normalized = normalizeLearnerUrl(rawUrl) || rawUrl.trim();
  const name = partName(normalized);
  const target = convertGitHubUrlToRaw(normalized) ?? normalized;
  try {
    const { url, response } = await guardedFetch(target, deps);
    if (response.status < 200 || response.status >= 300) {
      return [
        couldNotReadPart(
          name,
          "url",
          `the server answered HTTP ${response.status}`,
        ),
      ];
    }
    const contentType = (response.headers["content-type"] ?? "")
      .split(";")[0]
      .trim()
      .toLowerCase();
    if (
      contentType === "text/html" ||
      contentType === "application/xhtml+xml"
    ) {
      const text = htmlToText(response.body.toString("utf8"));
      return [
        { name, kind: "text", text: `Page text of ${url.href}\n\n${text}` },
      ];
    }
    // Raw files (GitHub raw serves text/plain) and documents: by the path's
    // extension, falling back to the content type.
    const pathName = decodeURIComponent(url.pathname.split("/").pop() ?? "");
    const parts = await bytesToParts(
      pathName.includes(".") ? pathName : `${pathName || "download"}.bin`,
      contentType || undefined,
      response.body,
      { ...DEFAULT_MATERIALIZE_LIMITS, maxFileBytes: FETCH_MAX_BYTES },
    );
    return parts.map((part, index) => ({
      ...part,
      name: parts.length === 1 ? name : `${name} #${index + 1}`,
      ...(part.kind === "text" && part.text?.startsWith("could not read ")
        ? { text: `could not read ${name} (${contentType || "unknown type"})` }
        : {}),
    }));
  } catch (error) {
    if (error instanceof MaterializeLimitError) throw error;
    const reason = describeFailure(error);
    logger?.warn("grading.v3.url_fetch_failed", {
      host: safeHost(target),
      reason,
      errorClass: error instanceof Error ? error.name : typeof error,
    });
    return [couldNotReadPart(name, "url", reason)];
  }
}
