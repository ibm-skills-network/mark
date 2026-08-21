import { getBaseApiPath } from "@/config/constants";
import type {
  MultipartUploadAbortRequest,
  MultipartUploadCompleteRequest,
  MultipartUploadCompletedPart,
  MultipartUploadInitiateResponse,
  UploadRequest,
} from "@config/types";
import { APIError, apiClient } from "./api-client";
import {
  sendWithStallDetection,
  UploadTransportError,
} from "./uploadTransport";

interface UploadProgress {
  loaded: number;
  total: number;
  percentage: number;
}

/**
 * Information passed to the `onWaiting` callback when the server returns a
 * 503 with a `retryAfterMs` hint indicating the processing budget is full.
 */
export interface UploadWaitingInfo {
  retryAfterMs: number;
  attempt: number;
  maxAttempts: number;
}

/**
 * Friendly user-facing error class. Carries an optional `userMessage` that
 * the UI can show to the user verbatim instead of falling back to a generic
 * "Failed to upload" toast.
 */
export class UploadError extends Error {
  constructor(
    message: string,
    public readonly userMessage: string,
    public readonly status?: number,
    public readonly retryable = false,
  ) {
    super(message);
    this.name = "UploadError";
  }
}

// Per-part defaults: 3 retries, 1s initial backoff. Each attempt is bounded
// by the transport's stall watchdog rather than a flat timeout, so a part
// that is merely slow keeps going while one that is black-holed gives up in
// seconds instead of minutes.
const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_RETRY_DELAY = 1000;

// /initiate retry tuning for 503-busy: wait up to ~5 attempts ~= 1 minute
// before giving up; matches the server's queue timeout window.
const INITIATE_MAX_RETRIES = 5;
const INITIATE_DEFAULT_BACKOFF_MS = 5000;

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function extractBusyRetryAfter(error: unknown): number | undefined {
  if (!(error instanceof APIError) || error.status !== 503) return undefined;
  const body = error.body;
  if (!body || typeof body !== "object") return undefined;
  const candidate = (body as { retryAfterMs?: unknown }).retryAfterMs;
  return typeof candidate === "number" && candidate > 0 ? candidate : undefined;
}

function extractServerMessage(error: unknown): string | undefined {
  if (!(error instanceof APIError)) return undefined;
  const body = error.body;
  if (!body || typeof body !== "object") return undefined;
  const message = (body as { message?: unknown }).message;
  if (typeof message === "string" && message.trim().length > 0) return message;
  if (Array.isArray(message) && typeof message[0] === "string")
    return message[0];
  return undefined;
}

async function initiateMultipartUpload(
  uploadRequest: UploadRequest,
  onWaiting?: (info: UploadWaitingInfo) => void,
): Promise<MultipartUploadInitiateResponse> {
  const url = `${getBaseApiPath("v1")}/files/upload/initiate`;

  let lastError: unknown;
  for (let attempt = 1; attempt <= INITIATE_MAX_RETRIES; attempt++) {
    try {
      return await apiClient.post<MultipartUploadInitiateResponse>(
        url,
        uploadRequest,
        { quiet: true },
      );
    } catch (error) {
      lastError = error;
      const retryAfter = extractBusyRetryAfter(error);
      if (!retryAfter || attempt === INITIATE_MAX_RETRIES) break;
      onWaiting?.({
        retryAfterMs: retryAfter,
        attempt,
        maxAttempts: INITIATE_MAX_RETRIES,
      });
      await sleep(retryAfter || INITIATE_DEFAULT_BACKOFF_MS);
    }
  }

  if (lastError instanceof APIError) {
    if (lastError.status === 400) {
      // Distinguish user-actionable 400s (file too large — carries the byte
      // limit) from developer-language 400s (missing assignmentId etc. —
      // the user can't fix those). Show the server message only for the
      // size case so we never leak developer copy into the UI.
      const serverMessage = extractServerMessage(lastError);
      const isSizeError =
        !!serverMessage &&
        /too large|max(?:imum)? (?:allowed|size)/i.test(serverMessage);
      throw new UploadError(
        lastError.message,
        isSizeError && serverMessage
          ? serverMessage
          : "We couldn't start this upload. Please refresh and try again, or pick a different file.",
        400,
        false,
      );
    }
    if (lastError.status === 503) {
      throw new UploadError(
        lastError.message,
        "Uploads are temporarily busy. Please try again in a moment.",
        503,
        true,
      );
    }
    if (lastError.status === 403) {
      throw new UploadError(
        lastError.message,
        "You don't have permission to upload this file.",
        403,
        false,
      );
    }
    if (lastError.status === 401) {
      throw new UploadError(
        lastError.message,
        "Your session expired. Please refresh and try again.",
        401,
        false,
      );
    }
    if (lastError.status >= 500) {
      throw new UploadError(
        lastError.message,
        "We hit a server issue starting this upload. Please try again.",
        lastError.status,
        false,
      );
    }
  }
  throw new UploadError(
    lastError instanceof Error ? lastError.message : String(lastError),
    "We couldn't start this upload. Please check your connection and try again.",
    undefined,
    false,
  );
}

async function completeMultipartUpload(
  request: MultipartUploadCompleteRequest,
): Promise<void> {
  const url = `${getBaseApiPath("v1")}/files/upload/complete`;
  try {
    await apiClient.post(url, request, { quiet: true });
  } catch (error) {
    if (error instanceof APIError && error.status === 400) {
      throw new UploadError(
        error.message,
        extractServerMessage(error) ??
          "The uploaded file exceeded the allowed size and was rejected.",
        400,
        false,
      );
    }
    throw error;
  }
}

async function abortMultipartUpload(
  request: MultipartUploadAbortRequest,
): Promise<void> {
  const url = `${getBaseApiPath("v1")}/files/upload/abort`;
  // Best-effort: swallow errors so the original upload error is always what propagates.
  await apiClient.post(url, request, { quiet: true }).catch(() => undefined);
}

async function uploadPartWithRetry(
  chunk: Blob,
  partUrl: string,
  options: {
    maxRetries?: number;
    retryDelay?: number;
    onPartProgress?: (loadedBytes: number) => void;
  } = {},
): Promise<string> {
  const {
    maxRetries = DEFAULT_MAX_RETRIES,
    retryDelay = DEFAULT_RETRY_DELAY,
    onPartProgress,
  } = options;

  let lastError: Error | undefined;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const response = await sendWithStallDetection({
        method: "PUT",
        url: partUrl,
        body: chunk,
        totalBytes: chunk.size,
        onUploadProgress: (progress) => onPartProgress?.(progress.loaded),
      });

      if (response.status < 200 || response.status >= 300) {
        throw new UploadError(
          `Part upload failed with status ${response.status}`,
          "We hit a problem while uploading. Please try again.",
          response.status,
          response.status >= 500,
        );
      }

      // S3 returns an ETag per part; collected and sent in the complete call.
      // If the browser can't read it the bucket CORS is missing
      // Access-Control-Expose-Headers: ETag. No retry fixes that, but routing
      // the file through the API does — so classify it as reroutable.
      const etag = response.getResponseHeader("etag");
      if (!etag) {
        throw new UploadTransportError(
          "Multipart upload response missing ETag header (CORS expose-headers misconfigured)",
          "cors",
        );
      }

      onPartProgress?.(chunk.size);
      return etag;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      // A stall or a cross-origin rejection is a property of the route, not
      // of this attempt — retrying just burns the learner's time.
      if (
        lastError instanceof UploadTransportError &&
        lastError.kind !== "network"
      ) {
        break;
      }
      // Server-config errors won't get better on retry
      if (lastError instanceof UploadError && !lastError.retryable) {
        break;
      }

      if (attempt < maxRetries) {
        // Exponential backoff: 1s → 2s → 4s
        const backoffDelay = retryDelay * Math.pow(2, attempt);
        await sleep(backoffDelay);
      }
    }
  }

  throw lastError || new Error("Multipart upload failed");
}

export async function reliableUpload(
  file: File,
  uploadRequest: UploadRequest,
  onProgress?: (progress: UploadProgress) => void,
  onWaiting?: (info: UploadWaitingInfo) => void,
): Promise<MultipartUploadInitiateResponse> {
  if (file.size === 0) {
    throw new Error("Cannot upload empty file");
  }

  const multipartUpload = await initiateMultipartUpload(
    uploadRequest,
    onWaiting,
  );

  if (!multipartUpload.uploadId || !multipartUpload.urls?.length) {
    throw new Error("Failed to initialize multipart upload");
  }

  const completedParts: MultipartUploadCompletedPart[] = [];
  let completedBytes = 0;

  try {
    for (const part of multipartUpload.urls) {
      // Compute the byte range for this part
      const start = (part.partNumber - 1) * multipartUpload.partSizeBytes;
      const end = Math.min(start + multipartUpload.partSizeBytes, file.size);
      const chunk = file.slice(start, end);

      // PUT the chunk directly to S3 via its presigned URL; returns the ETag
      const etag = await uploadPartWithRetry(chunk, part.url, {
        onPartProgress: (partLoaded) => {
          // Report within-part progress so the bar moves during a part
          // instead of jumping once per completed chunk.
          const loadedBytes = completedBytes + Math.min(partLoaded, chunk.size);
          onProgress?.({
            loaded: loadedBytes,
            total: file.size,
            percentage: Math.round((loadedBytes / file.size) * 100),
          });
        },
      });
      completedBytes += chunk.size;

      // S3 needs each part's ETag to assemble the final object
      completedParts.push({
        partNumber: part.partNumber,
        etag,
      });
    }

    await completeMultipartUpload({
      uploadId: multipartUpload.uploadId,
      key: multipartUpload.key,
      uploadType: uploadRequest.uploadType,
      parts: completedParts,
    });
  } catch (error) {
    await abortMultipartUpload({
      uploadId: multipartUpload.uploadId,
      key: multipartUpload.key,
      uploadType: uploadRequest.uploadType,
    });
    throw error;
  }

  onProgress?.({
    loaded: file.size,
    total: file.size,
    percentage: 100,
  });

  return multipartUpload;
}
