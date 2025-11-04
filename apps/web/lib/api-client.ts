import {
  DataTransformer,
  TransformConfig,
} from "@/app/Helpers/data-transformer";
import { API_DECODE_CONFIG } from "@/app/Helpers/transform-config";

interface APIClientConfig {
  baseURL?: string;
  autoTransform?: boolean;
  transformConfig?: TransformConfig;
  defaultHeaders?: Record<string, string>;
  timeout?: number;
}

interface RequestOptions {
  headers?: Record<string, string>;
  transformRequest?: boolean;
  transformResponse?: boolean;
  transformConfig?: TransformConfig;
  signal?: AbortSignal;
}

/**
 * Enhanced HTTP client with automatic data transformation
 */
export class APIClient {
  private baseURL: string;
  private autoTransform: boolean;
  private transformConfig: TransformConfig;
  private defaultHeaders: Record<string, string>;
  private timeout: number;

  constructor(config: APIClientConfig = {}) {
    this.baseURL = config.baseURL || "";
    this.autoTransform = config.autoTransform ?? true;
    this.transformConfig = config.transformConfig || {};
    this.defaultHeaders = config.defaultHeaders || {};
    this.timeout = config.timeout || 60000;
  }

  /**
   * Make GET request with automatic response transformation
   */
  async get<T = any>(url: string, options: RequestOptions = {}): Promise<T> {
    return this.request<T>("GET", url, undefined, options);
  }

  /**
   * Make POST request with automatic request/response transformation
   */
  async post<T = any>(
    url: string,
    data?: any,
    options: RequestOptions = {},
  ): Promise<T> {
    return this.request<T>("POST", url, data, options);
  }

  /**
   * Make PUT request with automatic request/response transformation
   */
  async put<T = any>(
    url: string,
    data?: any,
    options: RequestOptions = {},
  ): Promise<T> {
    return this.request<T>("PUT", url, data, options);
  }

  /**
   * Make PATCH request with automatic request/response transformation
   */
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

  /**
   * Core request method with transformation logic
   */
  private async request<T>(
    method: string,
    url: string,
    data?: any,
    options: RequestOptions = {},
  ): Promise<T> {
    const {
      headers = {},
      transformRequest = this.autoTransform,
      transformResponse = this.autoTransform,
      transformConfig,
      signal,
    } = options;

    const finalTransformConfig = {
      ...this.transformConfig,
      ...transformConfig,
    };
    const fullURL = this.buildURL(url);

    let requestBody: string | undefined;
    if (data) {
      const processedData = transformRequest
        ? DataTransformer.encodeForAPI(data, finalTransformConfig).data
        : data;
      requestBody = JSON.stringify(processedData);
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
        cache: "no-store", // Disable caching to prevent stale responses
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new APIError(
          `HTTP ${response.status}: ${response.statusText}`,
          response.status,
          response.statusText,
        );
      }

      const responseData = await response.json();

      return transformResponse
        ? DataTransformer.decodeFromAPI(responseData, finalTransformConfig)
        : responseData;
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
    if (config.transformConfig)
      this.transformConfig = {
        ...this.transformConfig,
        ...config.transformConfig,
      };
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
      transformConfig: this.transformConfig,
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
  autoTransform: true, // Frontend handles encoding requests and decoding responses
  transformConfig: API_DECODE_CONFIG,
});

/**
 * Utility function to create API client with custom configuration
 */
export function createAPIClient(config: APIClientConfig): APIClient {
  return new APIClient(config);
}
