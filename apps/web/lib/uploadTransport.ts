/**
 * Transport primitives shared by every browser upload path.
 *
 * The upload legs that talk straight to object storage are the ones users
 * cannot route around: the browser opens a connection to a storage domain
 * that is not the site's own origin. Corporate proxies and filtering
 * appliances routinely accept that connection and then never answer, which
 * leaves a bare XMLHttpRequest hanging forever — no error event, no timeout,
 * a progress bar frozen at 0%.
 *
 * Everything here exists to make that failure finite and classifiable:
 *  - a stall watchdog turns "silently hanging" into an abort with a reason
 *  - failures are tagged network / stalled / cors / aborted so callers can
 *    decide whether retrying over a different route can possibly help
 */

/**
 * Zero-byte-progress window during body transmission.
 *
 * XHR emits upload progress as bytes are handed to the socket, so even a
 * 256 kbps link produces events continuously. A 20s gap with no byte
 * advancing means the socket is not draining at all — comfortably past a
 * single TCP retransmission backoff cycle (which resolves inside ~16s), so
 * we are not pre-empting a link that is merely slow or briefly wedged.
 */
export const UPLOAD_STALL_TIMEOUT_MS = 20_000;

/**
 * Grace period for the response once the whole body has been handed off.
 *
 * A small file fits entirely in the kernel socket buffer, so XHR can report
 * 100% within milliseconds of send() while not one byte has reached the
 * server. The stall watchdog cannot see that, so the wait for response
 * headers gets its own budget: this constant plus the time the body would
 * take on a deliberately pessimistic link (see below).
 */
export const UPLOAD_RESPONSE_GRACE_MS = 20_000;

/**
 * Assumed floor throughput used to size the response budget.
 *
 * Deliberately pessimistic (256 kbps). Over-estimating the link speed would
 * abort uploads that are slow but alive; under-estimating only delays the
 * rescue. 32 KiB/s is below any link a learner can realistically load the
 * app over, so a false abort needs a genuinely broken connection.
 */
export const UPLOAD_MIN_BYTES_PER_SECOND = 32 * 1024;

/** Hard ceiling on the response budget, matching the multipart part budget. */
export const UPLOAD_RESPONSE_TIMEOUT_CAP_MS = 5 * 60 * 1000;

/**
 * Largest file we will re-send through the API when the storage domain is
 * unreachable.
 *
 * The rescue request crosses the same-origin UI proxy, and bodies of 10MB and
 * above die there against its ~30s timeout while 5MB clears in ~1s (measured
 * on staging) — so anything above this cap would fail the learner a second
 * time rather than rescue them. Every stalled upload reported so far was
 * under 2MB.
 */
export const DIRECT_UPLOAD_FALLBACK_MAX_BYTES = 5 * 1024 * 1024;

/**
 * network — the request never produced an HTTP response (DNS, refused
 *           connection, TLS failure, or a cross-origin rejection)
 * stalled — the stall watchdog fired: no bytes moved and no response arrived
 * cors    — an HTTP response arrived but the browser withheld what we need
 *           from it, so the storage leg cannot be completed from a browser
 * aborted — the caller cancelled deliberately
 */
export type UploadFailureKind = "network" | "stalled" | "cors" | "aborted";

export class UploadTransportError extends Error {
  constructor(
    message: string,
    public readonly kind: UploadFailureKind,
  ) {
    super(message);
    this.name = "UploadTransportError";
  }
}

/**
 * True when the failure means "these bytes never reached a server", which is
 * the only case where re-sending over a different route can help. An HTTP
 * status — from storage or from our own API — proves the network works and is
 * never reroutable.
 */
export function isReroutableFailure(error: unknown): boolean {
  return (
    error instanceof UploadTransportError &&
    (error.kind === "network" ||
      error.kind === "stalled" ||
      error.kind === "cors")
  );
}

export function failureKindOf(error: unknown): UploadFailureKind {
  return error instanceof UploadTransportError ? error.kind : "network";
}

/**
 * How long to wait for a response after the body has been fully handed off.
 * Scales with the payload because the bytes XHR already counted as "sent" may
 * still be draining out of the socket buffer on a slow link.
 */
export function computeResponseTimeoutMs(totalBytes: number): number {
  const safeBytes =
    Number.isFinite(totalBytes) && totalBytes > 0 ? totalBytes : 0;
  const drainMs = Math.ceil(safeBytes / UPLOAD_MIN_BYTES_PER_SECOND) * 1000;
  return Math.min(
    UPLOAD_RESPONSE_GRACE_MS + drainMs,
    UPLOAD_RESPONSE_TIMEOUT_CAP_MS,
  );
}

export interface UploadTransportResponse {
  status: number;
  responseText: string;
  getResponseHeader: (name: string) => string | null;
}

export interface UploadTransportRequest {
  method: "PUT" | "POST";
  url: string;
  body: XMLHttpRequestBodyInit;
  /** Size of `body` in bytes, used to size the response budget. */
  totalBytes: number;
  headers?: Record<string, string>;
  signal?: AbortSignal;
  onUploadProgress?: (progress: { loaded: number; total: number }) => void;
}

/**
 * Send a body with XHR under a stall watchdog.
 *
 * Resolves for any HTTP response, including 4xx/5xx — reading the status is
 * the caller's job, because "the server said no" and "the server was never
 * reached" call for completely different handling. Rejects with an
 * `UploadTransportError` only when no response was produced.
 */
export function sendWithStallDetection(
  request: UploadTransportRequest,
): Promise<UploadTransportResponse> {
  return new Promise<UploadTransportResponse>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let lastLoaded = 0;
    let settled = false;
    let stalled = false;
    let cancelled = false;
    let headersReceived = false;

    const clearWatchdog = (): void => {
      if (timer !== undefined) {
        clearTimeout(timer);
        timer = undefined;
      }
    };

    const armWatchdog = (delayMs: number): void => {
      clearWatchdog();
      timer = setTimeout(() => {
        stalled = true;
        xhr.abort();
      }, delayMs);
    };

    const onSignalAbort = (): void => {
      cancelled = true;
      xhr.abort();
    };

    const finish = (): void => {
      settled = true;
      clearWatchdog();
      request.signal?.removeEventListener("abort", onSignalAbort);
    };

    const fail = (message: string, kind: UploadFailureKind): void => {
      if (settled) return;
      finish();
      reject(new UploadTransportError(message, kind));
    };

    if (request.signal?.aborted) {
      reject(new UploadTransportError("Upload cancelled", "aborted"));
      return;
    }
    request.signal?.addEventListener("abort", onSignalAbort);

    xhr.upload.addEventListener("progress", (event: ProgressEvent) => {
      if (!event.lengthComputable) return;
      if (event.loaded <= lastLoaded) return;
      lastLoaded = event.loaded;
      armWatchdog(UPLOAD_STALL_TIMEOUT_MS);
      request.onUploadProgress?.({ loaded: event.loaded, total: event.total });
    });

    // Body fully handed to the network stack: from here nothing more will
    // progress until the server answers, so switch to the response budget.
    xhr.upload.addEventListener("load", () => {
      if (headersReceived) return;
      armWatchdog(computeResponseTimeoutMs(request.totalBytes));
    });

    // Headers are in — the peer is alive and answering, so stop watching.
    xhr.addEventListener("readystatechange", () => {
      if (xhr.readyState >= XMLHttpRequest.HEADERS_RECEIVED) {
        headersReceived = true;
        clearWatchdog();
      }
    });

    xhr.addEventListener("load", () => {
      if (settled) return;
      // status 0 with a "successful" load is how browsers surface a blocked
      // cross-origin request; no response ever became readable.
      if (xhr.status === 0) {
        fail(
          `Upload to ${safeOrigin(request.url)} produced no readable response`,
          "network",
        );
        return;
      }
      finish();
      resolve({
        status: xhr.status,
        responseText: xhr.responseText,
        getResponseHeader: (name: string) => xhr.getResponseHeader(name),
      });
    });

    xhr.addEventListener("error", () => {
      fail(
        `Upload to ${safeOrigin(request.url)} failed before any response`,
        "network",
      );
    });

    xhr.addEventListener("timeout", () => {
      fail(`Upload to ${safeOrigin(request.url)} timed out`, "stalled");
    });

    xhr.addEventListener("abort", () => {
      if (stalled) {
        fail(
          `Upload to ${safeOrigin(request.url)} stalled with no progress`,
          "stalled",
        );
        return;
      }
      fail("Upload cancelled", "aborted");
    });

    xhr.open(request.method, request.url);
    for (const [name, value] of Object.entries(request.headers ?? {})) {
      xhr.setRequestHeader(name, value);
    }

    // Armed before send() so a connection that is accepted and then never
    // answered — the black-hole proxy case — still has a deadline even though
    // it never produces a single progress event.
    armWatchdog(UPLOAD_STALL_TIMEOUT_MS);
    xhr.send(request.body);

    if (cancelled) {
      xhr.abort();
    }
  });
}

/**
 * Origin of a URL for log/error text. Presigned URLs carry credentials in the
 * query string, so the full URL must never reach a message.
 */
function safeOrigin(url: string): string {
  try {
    return new URL(url, "http://localhost").origin;
  } catch {
    return "storage";
  }
}
