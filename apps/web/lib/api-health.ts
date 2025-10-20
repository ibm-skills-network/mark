/**
 * API Health Check and Connection Utilities
 */

const API_GATEWAY_HOST =
  process.env.API_GATEWAY_HOST || "http://localhost:8000";

/**
 * Check if API Gateway is healthy
 */
export async function checkApiHealth(): Promise<boolean> {
  try {
    const response = await fetch(`${API_GATEWAY_HOST}/health`, {
      method: "GET",
      signal: AbortSignal.timeout(5000), // 5 second timeout
    });
    return response.ok;
  } catch (error) {
    console.warn("API health check failed:", error);
    return false;
  }
}

/**
 * Wait for API Gateway to be ready with exponential backoff
 */
export async function waitForApiReady(maxRetries = 30): Promise<boolean> {
  let retries = 0;
  let delay = 1000; // Start with 1 second

  while (retries < maxRetries) {
    const isHealthy = await checkApiHealth();

    if (isHealthy) {
      console.log("✅ API Gateway is ready");
      return true;
    }

    retries++;

    await new Promise((resolve) => setTimeout(resolve, delay));

    // Exponential backoff with max 5 seconds
    delay = Math.min(delay * 1.2, 5000);
  }

  console.error(
    "❌ API Gateway failed to become ready after",
    maxRetries,
    "retries",
  );
  return false;
}

/**
 * Make API request with retry logic
 */
export async function apiRequestWithRetry(
  url: string,
  options: RequestInit = {},
  maxRetries = 3,
): Promise<Response> {
  let lastError: Error;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const response = await fetch(url, {
        ...options,
        signal: AbortSignal.timeout(10000), // 10 second timeout
      });

      // If successful, return immediately
      if (response.ok || response.status < 500) {
        return response;
      }

      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    } catch (error) {
      lastError = error as Error;

      // Don't retry on certain errors
      if (
        error instanceof TypeError &&
        error.message.includes("Failed to fetch")
      ) {
        console.warn(
          `API request failed on attempt ${attempt}:`,
          error.message,
        );

        if (attempt < maxRetries) {
          const delay = attempt * 1000; // Linear backoff
          await new Promise((resolve) => setTimeout(resolve, delay));
          continue;
        }
      }

      // For other errors, throw immediately
      throw error;
    }
  }

  throw lastError;
}
