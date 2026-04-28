import { getBaseApiPath } from "@/config/constants";
import type {
  MultipartUploadCompleteRequest,
  MultipartUploadCompletedPart,
  MultipartUploadInitiateResponse,
  UploadRequest,
} from "@config/types";
import { apiClient } from "./api-client";

interface UploadProgress {
  loaded: number;
  total: number;
  percentage: number;
}

// Per-part defaults: 3 retries, 1s initial backoff, 5-minute timeout
const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_RETRY_DELAY = 1000;
const DEFAULT_TIMEOUT = 5 * 60 * 1000;

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function initiateMultipartUpload(
  uploadRequest: UploadRequest,
): Promise<MultipartUploadInitiateResponse> {
  const url = `${getBaseApiPath("v1")}/files/upload/initiate`;
  return apiClient.post<MultipartUploadInitiateResponse>(url, uploadRequest);
}

async function completeMultipartUpload(
  request: MultipartUploadCompleteRequest,
): Promise<void> {
  const url = `${getBaseApiPath("v1")}/files/upload/complete`;
  await apiClient.post(url, request);
}

async function uploadPartWithRetry(
  chunk: Blob,
  partUrl: string,
  options: {
    maxRetries?: number;
    retryDelay?: number;
    timeout?: number;
    onUploadedBytes?: (loadedBytes: number) => void;
  } = {},
): Promise<string> {
  const {
    maxRetries = DEFAULT_MAX_RETRIES,
    retryDelay = DEFAULT_RETRY_DELAY,
    timeout = DEFAULT_TIMEOUT,
    onUploadedBytes,
  } = options;

  let lastError: Error | undefined;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeout);

      const response = await fetch(partUrl, {
        method: "PUT",
        body: chunk,
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(
          `Upload failed with status ${response.status}: ${response.statusText}`,
        );
      }

      // S3 returns an ETag per part; collected and sent in the complete call
      const etag = response.headers.get("etag");
      if (!etag) {
        throw new Error("Multipart upload response missing ETag header");
      }

      onUploadedBytes?.(chunk.size);
      return etag;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      // Timeout aborts are not retryable
      if (lastError.name === "AbortError") {
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
): Promise<MultipartUploadInitiateResponse> {
  if (file.size === 0) {
    throw new Error("Cannot upload empty file");
  }

  const multipartUpload = await initiateMultipartUpload(uploadRequest);

  if (!multipartUpload.uploadId || !multipartUpload.urls?.length) {
    throw new Error("Failed to initialize multipart upload");
  }

  const completedParts: MultipartUploadCompletedPart[] = [];
  let loadedBytes = 0;

  for (const part of multipartUpload.urls) {
    // Compute the byte range for this part
    const start = (part.partNumber - 1) * multipartUpload.partSizeBytes;
    const end = Math.min(start + multipartUpload.partSizeBytes, file.size);
    const chunk = file.slice(start, end);

    // PUT the chunk directly to S3 via its presigned URL; returns the ETag
    const etag = await uploadPartWithRetry(chunk, part.url, {
      onUploadedBytes: (chunkBytes) => {
        loadedBytes += chunkBytes;
        onProgress?.({
          loaded: loadedBytes,
          total: file.size,
          percentage: Math.round((loadedBytes / file.size) * 100),
        });
      },
    });

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

  onProgress?.({
    loaded: file.size,
    total: file.size,
    percentage: 100,
  });

  return multipartUpload;
}
