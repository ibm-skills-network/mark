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
import type {
  GradingLogger,
  Part,
  UnreadableSource,
  UnreadableSourceCode,
} from "./contracts";
import { htmlToText } from "./html-text";
import {
  bytesToParts,
  DEFAULT_MATERIALIZE_LIMITS,
  MaterializeLimitError,
  unreadableCodeOf,
  UnreadableSourceError,
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

/** Why a URL could not be read, with the issue code the learner sees. */
export class UrlFetchRefusedError extends Error {
  constructor(
    message: string,
    readonly code: UnreadableSourceCode = "url_unreachable",
  ) {
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
      // `timeout` only fires on an idle socket; the signal bounds the whole
      // request, so a server dripping bytes can't hold the job open.
      timeout: timeoutMs,
      signal: AbortSignal.timeout(timeoutMs),
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

const RETRYABLE_NETWORK_CODES = new Set([
  "ECONNABORTED",
  "ETIMEDOUT",
  "ECONNRESET",
  "ECONNREFUSED",
  "EAI_AGAIN",
  "EPIPE",
  "ERR_SOCKET_CONNECTION_TIMEOUT",
]);

/** Issue code and retryability for a failed fetch; no learner content. */
function classifyFailure(error: unknown): {
  code: UnreadableSourceCode;
  retryable: boolean;
} {
  if (error instanceof UrlFetchRefusedError) {
    return { code: error.code, retryable: false };
  }
  if (error instanceof BlockedUrlError) {
    return { code: "url_blocked", retryable: false };
  }
  const code = (error as { code?: unknown })?.code;
  if (code === "ERR_BLOCKED_ADDRESS") {
    return { code: "url_blocked", retryable: false };
  }
  if (
    error instanceof Error &&
    /maxcontentlength|content length/i.test(error.message)
  ) {
    return { code: "url_unsupported", retryable: false };
  }
  if (typeof code === "string" && RETRYABLE_NETWORK_CODES.has(code)) {
    return { code: "url_temporarily_unavailable", retryable: true };
  }
  if (
    error instanceof Error &&
    (error.name === "TimeoutError" || error.name === "CanceledError")
  ) {
    return { code: "url_temporarily_unavailable", retryable: true };
  }
  return { code: "url_unreachable", retryable: false };
}

/** 429 and 5xx may clear up; any other non-2xx is the learner's link. */
function statusSource(name: string, status: number): UnreadableSource {
  const retryable = status === 429 || status >= 500;
  return {
    kind: "url",
    code: retryable ? "url_temporarily_unavailable" : "url_unreachable",
    name,
    retryable,
    httpStatus: status,
  };
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
    throw new UrlFetchRefusedError("it is not a valid URL", "url_invalid");
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
        "url_unsupported",
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
 * A link that can't be read throws UnreadableSourceError: the submission is
 * not graded around it.
 */
export async function fetchUrlAsParts(
  rawUrl: string,
  deps: FetchUrlDeps = defaultFetchUrlDeps,
  logger?: GradingLogger,
): Promise<Part[]> {
  const normalized = normalizeLearnerUrl(rawUrl) || rawUrl.trim();
  const name = partName(normalized);
  const target = convertGitHubUrlToRaw(normalized) ?? normalized;
  const refuse = (source: UnreadableSource, errorClass?: string): never => {
    logger?.warn("grading.v3.url_fetch_failed", {
      host: safeHost(target),
      code: source.code,
      retryable: source.retryable,
      httpStatus: source.httpStatus,
      errorClass,
    });
    throw new UnreadableSourceError(source);
  };

  let url: URL;
  let response: FetchResponse;
  try {
    ({ url, response } = await guardedFetch(target, deps));
  } catch (error) {
    if (error instanceof MaterializeLimitError) throw error;
    return refuse(
      { kind: "url", name, ...classifyFailure(error) },
      error instanceof Error ? error.name : typeof error,
    );
  }
  if (response.status < 200 || response.status >= 300) {
    return refuse(statusSource(name, response.status));
  }
  if (response.body.toString("utf8").trim().length === 0) {
    return refuse({ kind: "url", code: "url_empty", name, retryable: false });
  }
  const contentType = (response.headers["content-type"] ?? "")
    .split(";")[0]
    .trim()
    .toLowerCase();
  if (contentType === "text/html" || contentType === "application/xhtml+xml") {
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
  if (unreadableCodeOf(parts)) {
    return refuse({
      kind: "url",
      code: "url_unsupported",
      name,
      retryable: false,
    });
  }
  return parts.map((part, index) => ({
    ...part,
    name: parts.length === 1 ? name : `${name} #${index + 1}`,
  }));
}
