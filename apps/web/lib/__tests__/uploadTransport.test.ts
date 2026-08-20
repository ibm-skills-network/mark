/**
 * @jest-environment jsdom
 */

import {
  computeResponseTimeoutMs,
  DIRECT_UPLOAD_FALLBACK_MAX_BYTES,
  isReroutableFailure,
  sendWithStallDetection,
  UPLOAD_MIN_BYTES_PER_SECOND,
  UPLOAD_RESPONSE_GRACE_MS,
  UPLOAD_RESPONSE_TIMEOUT_CAP_MS,
  UPLOAD_STALL_TIMEOUT_MS,
  UploadTransportError,
} from "../uploadTransport";

type Listener = (event: unknown) => void;

class FakeEventTarget {
  private readonly listeners = new Map<string, Listener[]>();

  addEventListener(type: string, listener: Listener): void {
    const existing = this.listeners.get(type) ?? [];
    existing.push(listener);
    this.listeners.set(type, existing);
  }

  removeEventListener(type: string, listener: Listener): void {
    const existing = this.listeners.get(type) ?? [];
    this.listeners.set(
      type,
      existing.filter((candidate) => candidate !== listener),
    );
  }

  emit(type: string, event: unknown = {}): void {
    for (const listener of this.listeners.get(type) ?? []) {
      listener(event);
    }
  }
}

class FakeXhr extends FakeEventTarget {
  static readonly HEADERS_RECEIVED = 2;

  readonly upload = new FakeEventTarget();
  readonly open = jest.fn();
  readonly setRequestHeader = jest.fn();
  readonly send = jest.fn();

  readyState = 0;
  status = 0;
  responseText = "";
  aborted = false;
  responseHeaders: Record<string, string> = {};

  abort(): void {
    this.aborted = true;
    this.emit("abort");
  }

  getResponseHeader(name: string): string | null {
    return this.responseHeaders[name.toLowerCase()] ?? null;
  }

  /** Simulate a full server response arriving. */
  respond(status: number, body = ""): void {
    this.readyState = 4;
    this.status = status;
    this.responseText = body;
    this.emit("readystatechange");
    this.emit("load");
  }

  /** Simulate the request body being fully handed to the socket. */
  finishUpload(totalBytes: number): void {
    this.upload.emit("progress", {
      lengthComputable: true,
      loaded: totalBytes,
      total: totalBytes,
    });
    this.upload.emit("load");
  }
}

let currentXhr: FakeXhr;
const originalXhr = globalThis.XMLHttpRequest;

beforeEach(() => {
  jest.useFakeTimers();
  globalThis.XMLHttpRequest = jest.fn(() => {
    currentXhr = new FakeXhr();
    return currentXhr;
  }) as unknown as typeof XMLHttpRequest;
  (
    globalThis.XMLHttpRequest as unknown as { HEADERS_RECEIVED: number }
  ).HEADERS_RECEIVED = 2;
});

afterEach(() => {
  jest.clearAllTimers();
  jest.useRealTimers();
  globalThis.XMLHttpRequest = originalXhr;
});

const send = (totalBytes = 1024) =>
  sendWithStallDetection({
    method: "PUT",
    url: "https://storage.example.com/bucket/key?sig=secret",
    body: "payload",
    totalBytes,
  });

describe("stall budgets", () => {
  it("keeps the response budget above the transfer time of a fallback-sized file", () => {
    // The largest file the fallback will carry must not be aborted purely for
    // being slow on the pessimistic floor link.
    const worstCaseMs =
      (DIRECT_UPLOAD_FALLBACK_MAX_BYTES / UPLOAD_MIN_BYTES_PER_SECOND) * 1000;
    const budget = computeResponseTimeoutMs(DIRECT_UPLOAD_FALLBACK_MAX_BYTES);

    expect(budget).toBeGreaterThanOrEqual(worstCaseMs);
    expect(budget).toBeLessThanOrEqual(UPLOAD_RESPONSE_TIMEOUT_CAP_MS);
  });

  it("scales the response budget with payload size", () => {
    expect(computeResponseTimeoutMs(0)).toBe(UPLOAD_RESPONSE_GRACE_MS);
    expect(computeResponseTimeoutMs(UPLOAD_MIN_BYTES_PER_SECOND)).toBe(
      UPLOAD_RESPONSE_GRACE_MS + 1000,
    );
    expect(computeResponseTimeoutMs(UPLOAD_MIN_BYTES_PER_SECOND * 10)).toBe(
      UPLOAD_RESPONSE_GRACE_MS + 10_000,
    );
  });

  it("caps the response budget", () => {
    expect(computeResponseTimeoutMs(Number.MAX_SAFE_INTEGER)).toBe(
      UPLOAD_RESPONSE_TIMEOUT_CAP_MS,
    );
  });
});

describe("black-holed connection", () => {
  it("aborts when the request is accepted and nothing ever happens", async () => {
    const pending = send();
    const assertion = expect(pending).rejects.toMatchObject({
      kind: "stalled",
    });

    jest.advanceTimersByTime(UPLOAD_STALL_TIMEOUT_MS);
    await assertion;

    expect(currentXhr.aborted).toBe(true);
  });

  it("never leaks the presigned URL into the error message", async () => {
    const captured = send().catch((error: unknown) => error);

    jest.advanceTimersByTime(UPLOAD_STALL_TIMEOUT_MS);
    const error = await captured;

    expect(error).toBeInstanceOf(UploadTransportError);
    expect((error as Error).message).toContain("https://storage.example.com");
    expect((error as Error).message).not.toContain("sig=secret");
  });

  it("gives the response its own budget once the body is sent", async () => {
    const pending = send(UPLOAD_MIN_BYTES_PER_SECOND * 4);
    const assertion = expect(pending).rejects.toMatchObject({
      kind: "stalled",
    });

    currentXhr.finishUpload(UPLOAD_MIN_BYTES_PER_SECOND * 4);

    // Past the transfer stall window but inside the response budget.
    jest.advanceTimersByTime(UPLOAD_STALL_TIMEOUT_MS + 1000);
    expect(currentXhr.aborted).toBe(false);

    jest.advanceTimersByTime(UPLOAD_RESPONSE_GRACE_MS + 4000);
    await assertion;
  });
});

describe("slow but alive connection", () => {
  it("does not abort while bytes keep advancing", async () => {
    const pending = send(1000);

    for (let loaded = 100; loaded <= 900; loaded += 100) {
      jest.advanceTimersByTime(UPLOAD_STALL_TIMEOUT_MS - 1000);
      currentXhr.upload.emit("progress", {
        lengthComputable: true,
        loaded,
        total: 1000,
      });
    }

    expect(currentXhr.aborted).toBe(false);

    currentXhr.respond(200);
    await expect(pending).resolves.toMatchObject({ status: 200 });
  });

  it("stops watching once response headers arrive", async () => {
    const pending = send();
    currentXhr.readyState = 2;
    currentXhr.emit("readystatechange");

    jest.advanceTimersByTime(UPLOAD_RESPONSE_TIMEOUT_CAP_MS * 2);
    expect(currentXhr.aborted).toBe(false);

    currentXhr.respond(200);
    await expect(pending).resolves.toMatchObject({ status: 200 });
  });

  it("reports progress to the caller", async () => {
    const onUploadProgress = jest.fn();
    const pending = sendWithStallDetection({
      method: "PUT",
      url: "https://storage.example.com/bucket/key",
      body: "payload",
      totalBytes: 1000,
      onUploadProgress,
    });

    currentXhr.upload.emit("progress", {
      lengthComputable: true,
      loaded: 400,
      total: 1000,
    });
    // A repeated or regressed event must not be reported as progress.
    currentXhr.upload.emit("progress", {
      lengthComputable: true,
      loaded: 400,
      total: 1000,
    });

    expect(onUploadProgress).toHaveBeenCalledTimes(1);
    expect(onUploadProgress).toHaveBeenCalledWith({ loaded: 400, total: 1000 });

    currentXhr.respond(204);
    await pending;
  });
});

describe("failure classification", () => {
  it("treats a transport error as network class", async () => {
    const pending = send();
    const assertion = expect(pending).rejects.toMatchObject({
      kind: "network",
    });

    currentXhr.emit("error");
    await assertion;
  });

  it("treats a load with no readable status as network class", async () => {
    const pending = send();
    const assertion = expect(pending).rejects.toMatchObject({
      kind: "network",
    });

    currentXhr.readyState = 4;
    currentXhr.status = 0;
    currentXhr.emit("load");
    await assertion;
  });

  it("resolves rather than rejects for an HTTP error status", async () => {
    const pending = send();
    currentXhr.respond(403, "expired");

    await expect(pending).resolves.toMatchObject({
      status: 403,
      responseText: "expired",
    });
  });

  it("classifies a deliberate cancellation apart from a stall", async () => {
    const controller = new AbortController();
    const pending = sendWithStallDetection({
      method: "PUT",
      url: "https://storage.example.com/bucket/key",
      body: "payload",
      totalBytes: 10,
      signal: controller.signal,
    });

    const assertion = expect(pending).rejects.toMatchObject({
      kind: "aborted",
    });
    controller.abort();
    await assertion;
  });

  it("marks only unreachable-server failures as reroutable", () => {
    expect(isReroutableFailure(new UploadTransportError("x", "network"))).toBe(
      true,
    );
    expect(isReroutableFailure(new UploadTransportError("x", "stalled"))).toBe(
      true,
    );
    expect(isReroutableFailure(new UploadTransportError("x", "cors"))).toBe(
      true,
    );
    expect(isReroutableFailure(new UploadTransportError("x", "aborted"))).toBe(
      false,
    );
    expect(isReroutableFailure(new Error("HTTP 403"))).toBe(false);
  });
});
