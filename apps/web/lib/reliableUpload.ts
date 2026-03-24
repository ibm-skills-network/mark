/**
 * Reliable single-request upload service with retry logic and progress tracking.
 * For a single presigned PUT URL, we should upload the full file in one request.
 */

interface UploadProgress {
  loaded: number;
  total: number;
  percentage: number;
}

interface ReliableUploadOptions {
  onProgress?: (progress: UploadProgress) => void;
  maxRetries?: number;
  retryDelay?: number;
  timeout?: number;
}

const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_RETRY_DELAY = 1000;
const DEFAULT_TIMEOUT = 5 * 60 * 1000;

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function uploadSinglePutWithRetry(
  file: File,
  presignedUrl: string,
  options: ReliableUploadOptions = {},
): Promise<void> {
  const {
    onProgress,
    maxRetries = DEFAULT_MAX_RETRIES,
    retryDelay = DEFAULT_RETRY_DELAY,
    timeout = DEFAULT_TIMEOUT,
  } = options;

  let lastError: Error | undefined;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeout);

      const response = await fetch(presignedUrl, {
        method: "PUT",
        body: file,
        headers: {
          "Content-Type": file.type || "application/octet-stream",
        },
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(
          `Upload failed with status ${response.status}: ${response.statusText}`,
        );
      }

      if (onProgress) {
        onProgress({
          loaded: file.size,
          total: file.size,
          percentage: 100,
        });
      }

      return;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      if (lastError.name === "AbortError") {
        break;
      }

      if (attempt < maxRetries) {
        const backoffDelay = retryDelay * Math.pow(2, attempt);
        await sleep(backoffDelay);
      }
    }
  }

  throw lastError || new Error("Upload failed");
}

/**
 * Kept for backwards compatibility; now always uses a single PUT request.
 */
export async function uploadWithChunking(
  file: File,
  presignedUrl: string,
  options: ReliableUploadOptions = {},
): Promise<void> {
  if (file.size === 0) {
    throw new Error("Cannot upload empty file");
  }

  await uploadSinglePutWithRetry(file, presignedUrl, options);
}

/**
 * Upload with fetch retries first, then axios fallback for client-side progress events.
 */
export async function reliableUpload(
  file: File,
  presignedUrl: string,
  onProgress?: (progress: UploadProgress) => void,
): Promise<void> {
  try {
    await uploadWithChunking(file, presignedUrl, {
      onProgress,
      maxRetries: DEFAULT_MAX_RETRIES,
      retryDelay: DEFAULT_RETRY_DELAY,
      timeout: DEFAULT_TIMEOUT,
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
    } catch {
      throw new Error(
        `Upload failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}
