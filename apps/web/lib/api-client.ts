import { toast } from "sonner";

interface APIClientConfig {
  baseURL?: string;
  autoTransform?: boolean;
  transformConfig?: unknown;
  defaultHeaders?: Record<string, string>;
  timeout?: number;
}

interface RequestOptions {
  headers?: Record<string, string>;
  transformRequest?: boolean;
  transformResponse?: boolean;
  transformConfig?: unknown;
  signal?: AbortSignal;
}

export class APIClient {
  private baseURL: string;
  private autoTransform: boolean;
  private defaultHeaders: Record<string, string>;
  private timeout: number;

  constructor(config: APIClientConfig = {}) {
    this.baseURL = config.baseURL || "";
    this.autoTransform = config.autoTransform ?? false;
    this.defaultHeaders = config.defaultHeaders || {};
    this.timeout = config.timeout || 60000;
  }

  async get<T = any>(url: string, options: RequestOptions = {}): Promise<T> {
    return this.request<T>("GET", url, undefined, options);
  }

  async post<T = any>(
    url: string,
    data?: any,
    options: RequestOptions = {},
  ): Promise<T> {
    return this.request<T>("POST", url, data, options);
  }

  async put<T = any>(
    url: string,
    data?: any,
    options: RequestOptions = {},
  ): Promise<T> {
    return this.request<T>("PUT", url, data, options);
  }

  async patch<T = any>(
    url: string,
    data?: any,
    options: RequestOptions = {},
  ): Promise<T> {
    return this.request<T>("PATCH", url, data, options);
  }

  /**
   * Make DELETE request
   */
  async delete<T = any>(url: string, options: RequestOptions = {}): Promise<T> {
    return this.request<T>("DELETE", url, undefined, options);
  }

  private async request<T>(
    method: string,
    url: string,
    data?: any,
    options: RequestOptions = {},
  ): Promise<T> {
    const { headers = {}, signal } = options;

    const fullURL = this.buildURL(url);

    let requestBody: string | undefined;
    if (data) {
      requestBody = JSON.stringify(data);
    }

    const requestHeaders = {
      "Content-Type": "application/json",
      ...this.defaultHeaders,
      ...headers,
    };

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

    try {
      const response = await fetch(fullURL, {
        method,
        headers: requestHeaders,
        body: requestBody,
        signal: signal || controller.signal,
        cache: "no-store",
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        if (response.status >= 500) {
          toast.error(
            `Server Error: ${response.status} ${response.statusText}`,
          );
        } else if (response.status === 403) {
          toast.error(
            `Forbidden: You don't have permission to access this Assessment.`,
          );
        } else {
          toast.error(
            `Client Error: ${response.status} ${response.statusText}`,
          );
        }

        throw new APIError(
          response.statusText,
          response.status,
          response.statusText,
        );
      }

      const responseData = await response.json();

      return responseData;
    } catch (error) {
      clearTimeout(timeoutId);

      if (error instanceof DOMException && error.name === "AbortError") {
        throw new APIError("Request timeout", 408, "Request Timeout");
      }

      throw error;
    }
  }

  /**
   * Build full URL from base URL and endpoint
   */
  private buildURL(url: string): string {
    if (url.startsWith("http")) {
      return url;
    }
    return `${this.baseURL}${url.startsWith("/") ? "" : "/"}${url}`;
  }

  /**
   * Update default configuration
   */
  updateConfig(config: Partial<APIClientConfig>): void {
    if (config.baseURL !== undefined) this.baseURL = config.baseURL;
    if (config.autoTransform !== undefined)
      this.autoTransform = config.autoTransform;
    if (config.defaultHeaders)
      this.defaultHeaders = {
        ...this.defaultHeaders,
        ...config.defaultHeaders,
      };
    if (config.timeout !== undefined) this.timeout = config.timeout;
  }

  /**
   * Create a new instance with different configuration
   */
  create(config: APIClientConfig): APIClient {
    return new APIClient({
      baseURL: this.baseURL,
      autoTransform: this.autoTransform,
      defaultHeaders: this.defaultHeaders,
      timeout: this.timeout,
      ...config,
    });
  }
}

/**
 * Custom error class for API operations
 */
export class APIError extends Error {
  constructor(
    message: string,
    public status: number,
    public statusText: string,
  ) {
    super(message);
    this.name = "APIError";
  }
}

/**
 * Default API client instance
 */
export const apiClient = new APIClient({
  baseURL: process.env.NEXT_PUBLIC_API_URL || "",
  autoTransform: false,
});

/**
 * Utility function to create API client with custom configuration
 */
export function createAPIClient(config: APIClientConfig): APIClient {
  return new APIClient(config);
}
