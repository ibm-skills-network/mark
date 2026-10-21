/**
 * Failure reporting for learner file uploads.
 *
 * The storage leg is an XHR to another origin, so neither the request log nor
 * the API's own logs ever see it fail. When an upload fails at any step — or
 * only succeeds because the API fallback rescued it — the browser sends one
 * small event to the API, which logs it, and keeps a copy in the bug-report
 * diagnostics buffer. The event describes the route and the failure, never the
 * file: no name, no bytes, no exact size.
 */

import { getBaseApiPath } from "@/config/constants";
import type { UploadRequest } from "@config/types";
import { authorSessionHeaders } from "./author-session";
import { recordClientError } from "./request-log";
import { isAndroidWebView, isCourseraMobileApp } from "./upload-accept";
import {
  StorageHttpError,
  UploadTransportError,
  type StorageResponseDetails,
} from "./uploadTransport";

export type UploadPhase =
  | "presign"
  | "storage_put"
  | "multipart_initiate"
  | "multipart_part"
  | "multipart_complete";

export type UploadEventOutcome = "failed" | "fallback_succeeded";

export type UploadEventFailureKind =
  | "network"
  | "stall"
  | "cors"
  | "http"
  | "aborted"
  | "unknown";

export type FallbackOutcome = "succeeded" | "failed" | "too_large";

export type UploadSizeBucket =
  | "lt_1mb"
  | "1_5mb"
  | "5_10mb"
  | "10_50mb"
  | "gt_50mb";

/**
 * What happened during one upload, filled in as it goes. The first failure
 * recorded wins: a later failure of the fallback route is kept separately so
 * it never hides why the primary route failed.
 */
export interface UploadTrace {
  phase: UploadPhase;
  httpStatus: number | null;
  failureKind?: UploadEventFailureKind;
  storageResponse?: StorageResponseDetails;
  fallback?: { outcome: FallbackOutcome; httpStatus: number | null };
}

/** Body of POST /files/upload-events. Mirrors the API's DTO. */
export interface UploadEventPayload {
  phase: UploadPhase;
  outcome: UploadEventOutcome;
  httpStatus: number | null;
  failureKind: UploadEventFailureKind;
  fallbackAttempted: boolean;
  fallbackOutcome?: FallbackOutcome;
  fallbackHttpStatus?: number | null;
  sizeBucket: UploadSizeBucket;
  mimeType?: string;
  fileExtension?: string;
  responseServer?: string;
  hasAmzRequestId?: boolean;
  responseBodySnippet?: string;
  isWebView: boolean;
  isCourseraApp: boolean;
  inIframe: boolean;
  assignmentId?: number;
  questionId?: number;
  attemptId?: number;
}

const MB = 1024 * 1024;

export function createUploadTrace(phase: UploadPhase): UploadTrace {
  return { phase, httpStatus: null };
}

export function sizeBucketOf(bytes: number): UploadSizeBucket {
  if (bytes < MB) return "lt_1mb";
  if (bytes < 5 * MB) return "1_5mb";
  if (bytes < 10 * MB) return "5_10mb";
  if (bytes < 50 * MB) return "10_50mb";
  return "gt_50mb";
}

function statusOf(error: unknown): number | null {
  if (typeof error !== "object" || error === null) return null;
  const status = (error as { status?: unknown }).status;
  return typeof status === "number" && Number.isInteger(status) && status > 0
    ? status
    : null;
}

export function classifyUploadFailure(error: unknown): {
  kind: UploadEventFailureKind;
  status: number | null;
} {
  if (error instanceof UploadTransportError) {
    const kind = error.kind === "stalled" ? "stall" : error.kind;
    return { kind, status: null };
  }
  const status = statusOf(error);
  if (status !== null) return { kind: "http", status };
  if (
    typeof error === "object" &&
    error !== null &&
    (error as { name?: unknown }).name === "NetworkError"
  ) {
    return { kind: "network", status: null };
  }
  return { kind: "unknown", status: null };
}

/** Records why the primary route failed, unless a failure is already known. */
export function noteUploadFailure(trace: UploadTrace, error: unknown): void {
  if (trace.failureKind) return;
  const { kind, status } = classifyUploadFailure(error);
  trace.failureKind = kind;
  trace.httpStatus = status;
  if (error instanceof StorageHttpError) {
    trace.storageResponse = error.details;
  }
}

export function noteFallbackResult(
  trace: UploadTrace,
  outcome: FallbackOutcome,
  error?: unknown,
): void {
  trace.fallback = {
    outcome,
    httpStatus: error === undefined ? null : statusOf(error),
  };
}

function extensionOf(fileName: string): string | undefined {
  const dot = fileName.lastIndexOf(".");
  if (dot < 0 || dot === fileName.length - 1) return undefined;
  const extension = fileName.slice(dot + 1).toLowerCase();
  return /^[a-z0-9]{1,10}$/.test(extension) ? extension : undefined;
}

function mimeTypeOf(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const mime = value.split(";")[0].trim().toLowerCase();
  return /^[\w.+-]{1,50}\/[\w.+-]{1,60}$/.test(mime) ? mime : undefined;
}

function positiveInt(value: unknown): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0
    ? value
    : undefined;
}

function isFramed(): boolean {
  try {
    return window.self !== window.top;
  } catch {
    // Reading window.top across origins throws, which itself means framed.
    return true;
  }
}

export interface UploadEventInput {
  trace: UploadTrace;
  outcome: UploadEventOutcome;
  file: { size: number; name: string; type?: string };
  uploadRequest: UploadRequest;
  attemptId?: number;
  userAgent: string;
  inIframe: boolean;
}

export function buildUploadEvent(input: UploadEventInput): UploadEventPayload {
  const { trace, outcome, file, uploadRequest } = input;
  const storage = trace.storageResponse;
  return {
    phase: trace.phase,
    outcome,
    httpStatus: trace.httpStatus,
    failureKind: trace.failureKind ?? "unknown",
    fallbackAttempted: trace.fallback !== undefined,
    fallbackOutcome: trace.fallback?.outcome,
    fallbackHttpStatus: trace.fallback ? trace.fallback.httpStatus : undefined,
    sizeBucket: sizeBucketOf(file.size),
    mimeType: mimeTypeOf(uploadRequest.fileType || file.type),
    fileExtension: extensionOf(uploadRequest.fileName || file.name),
    responseServer: storage?.server,
    hasAmzRequestId: storage ? storage.hasAmzRequestId : undefined,
    responseBodySnippet: storage?.bodySnippet,
    isWebView: isAndroidWebView(input.userAgent),
    isCourseraApp: isCourseraMobileApp(input.userAgent),
    inIframe: input.inIframe,
    assignmentId: positiveInt(uploadRequest.context?.assignmentId),
    questionId: positiveInt(uploadRequest.context?.questionId),
    attemptId: positiveInt(input.attemptId),
  };
}

function summarize(event: UploadEventPayload): string {
  const status = event.httpStatus ?? "no status";
  const fallback = event.fallbackAttempted
    ? `fallback ${event.fallbackOutcome ?? "unknown"}`
    : "no fallback";
  return `${event.phase}: ${event.failureKind} (${status}); ${fallback}`;
}

/**
 * Report one upload's failure (or fallback rescue). Never throws and never
 * waits: the upload's own result must reach the learner unchanged whether or
 * not this report gets anywhere.
 */
export function reportUploadEvent(
  input: Omit<UploadEventInput, "userAgent" | "inIframe">,
): void {
  if (typeof window === "undefined") return;

  let event: UploadEventPayload;
  try {
    event = buildUploadEvent({
      ...input,
      userAgent: navigator.userAgent ?? "",
      inIframe: isFramed(),
    });
  } catch {
    // Building the report touches browser globals that embedded contexts can
    // lock down. A report we cannot build is simply not sent; the upload
    // outcome the learner sees is unaffected.
    return;
  }

  recordClientError(
    {
      name:
        event.outcome === "failed"
          ? "UploadFailure"
          : "UploadRescuedByFallback",
      message: summarize(event),
      kind: event.failureKind,
    },
    { where: "file-upload" },
  );

  try {
    void fetch(`${getBaseApiPath("v1")}/files/upload-events`, {
      method: "POST",
      keepalive: true,
      cache: "no-store",
      headers: {
        "Content-Type": "application/json",
        ...authorSessionHeaders(),
      },
      body: JSON.stringify(event),
    }).catch(() => {
      // Telemetry is best effort. The network that just failed the upload
      // may fail this too, and there is nowhere left to report that; the copy
      // in the diagnostics buffer above still reaches any bug report.
      return undefined;
    });
  } catch {
    // fetch itself can throw synchronously (e.g. keepalive body quota
    // exceeded). Same reasoning as above: never let reporting reach the UX.
  }
}
