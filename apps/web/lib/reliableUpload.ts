/**
 * Reliable file upload service with chunking, retry logic, and progress tracking
 * Handles files of any size with automatic retry and recovery
 */

interface UploadProgress {
  loaded: number;
  total: number;
  percentage: number;
  chunkIndex?: number;
  totalChunks?: number;
}

interface ChunkUploadResult {
  success: boolean;
  chunkIndex: number;
  etag?: string;
  error?: Error;
}

interface ReliableUploadOptions {
  onProgress?: (progress: UploadProgress) => void;
  chunkSize?: number;
  maxRetries?: number;
  retryDelay?: number;
  timeout?: number;
}

const DEFAULT_CHUNK_SIZE = 5 * 1024 * 1024;
const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_RETRY_DELAY = 1000;
const DEFAULT_TIMEOUT = 5 * 60 * 1000;

/**
 * Sleep utility for retry delays with exponential backoff
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Upload a single chunk with retry logic
 */
async function uploadChunkWithRetry(
  chunk: Blob,
  presignedUrl: string,
  chunkIndex: number,
  maxRetries: number,
  retryDelay: number,
  timeout: number,
  contentType: string,
): Promise<ChunkUploadResult> {
  let lastError: Error | undefined;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeout);

      const response = await fetch(presignedUrl, {
        method: "PUT",
        body: chunk,
        headers: {
          "Content-Type": contentType,
        },
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(
          `Upload failed with status ${response.status}: ${response.statusText}`,
        );
      }

      const etag = response.headers.get("ETag") || undefined;

      return {
        success: true,
        chunkIndex,
        etag,
      };
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      if (lastError.name === "AbortError") {
        // AbortError is expected when upload is cancelled - don't retry
        break;
      }

      if (attempt < maxRetries) {
        const backoffDelay = retryDelay * Math.pow(2, attempt);
        await sleep(backoffDelay);
      }
    }
  }

  return {
    success: false,
    chunkIndex,
    error: lastError,
  };
}

/**
 * Upload file using chunked upload with retry logic
 * For small files (< chunkSize), uses single PUT request
 * For large files, splits into chunks and uploads sequentially with retry
 */
export async function uploadWithChunking(
  file: File,
  presignedUrl: string,
  options: ReliableUploadOptions = {},
): Promise<void> {
  const {
    onProgress,
    chunkSize = DEFAULT_CHUNK_SIZE,
    maxRetries = DEFAULT_MAX_RETRIES,
    retryDelay = DEFAULT_RETRY_DELAY,
    timeout = DEFAULT_TIMEOUT,
  } = options;

  if (file.size === 0) {
    throw new Error("Cannot upload empty file");
  }

  const totalSize = file.size;
  const contentType = file.type || "application/octet-stream";

  if (totalSize <= chunkSize) {
    const result = await uploadChunkWithRetry(
      file,
      presignedUrl,
      0,
      maxRetries,
      retryDelay,
      timeout,
      contentType,
    );

    if (!result.success) {
      throw result.error || new Error("Upload failed");
    }

    if (onProgress) {
      onProgress({
        loaded: totalSize,
        total: totalSize,
        percentage: 100,
      });
    }

    return;
  }

  const totalChunks = Math.ceil(totalSize / chunkSize);

  let uploadedBytes = 0;

  for (let chunkIndex = 0; chunkIndex < totalChunks; chunkIndex++) {
    const start = chunkIndex * chunkSize;
    const end = Math.min(start + chunkSize, totalSize);
    const chunk = file.slice(start, end);

    const result = await uploadChunkWithRetry(
      chunk,
      presignedUrl,
      chunkIndex,
      maxRetries,
      retryDelay,
      timeout,
      contentType,
    );

    if (!result.success) {
      throw (
        result.error ||
        new Error(`Failed to upload chunk ${chunkIndex + 1}/${totalChunks}`)
      );
    }

    uploadedBytes += chunk.size;

    if (onProgress) {
      onProgress({
        loaded: uploadedBytes,
        total: totalSize,
        percentage: Math.round((uploadedBytes / totalSize) * 100),
        chunkIndex: chunkIndex + 1,
        totalChunks,
      });
    }
  }
}

/**
 * Upload file with automatic fallback and retry
 * Tries chunked upload first, falls back to direct upload if needed
 */
export async function reliableUpload(
  file: File,
  presignedUrl: string,
  onProgress?: (progress: UploadProgress) => void,
): Promise<void> {
  try {
    await uploadWithChunking(file, presignedUrl, {
      onProgress,
      maxRetries: 3,
      retryDelay: 1000,
      timeout: 5 * 60 * 1000,
    });
  } catch (error) {
    const axios = (await import("axios")).default;

    try {
      await axios.put(presignedUrl, file, {
        headers: {
          "Content-Type": file.type || "application/octet-stream",
        },
        onUploadProgress: onProgress
          ? (progressEvent) => {
              if (progressEvent.total) {
                onProgress({
                  loaded: progressEvent.loaded,
                  total: progressEvent.total,
                  percentage: Math.round(
                    (progressEvent.loaded / progressEvent.total) * 100,
                  ),
                });
              }
            }
          : undefined,
        timeout: 10 * 60 * 1000,
        maxContentLength: Infinity,
        maxBodyLength: Infinity,
      });
    } catch (axiosError) {
      throw new Error(
        `Upload failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}
