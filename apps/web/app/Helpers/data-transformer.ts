export interface TransformConfig {
  fields?: string[];
  exclude?: string[];
  deep?: boolean;
  compressionLevel?: "none" | "light" | "heavy";
}

export interface TransformMetadata {
  originalSize: number;
  encodedSize: number;
  compressionRatio: number;
  timestamp: number;
  fields: string[];
}

const transformCache = new Map<
  string,
  { data: any; metadata: TransformMetadata; expiry: number }
>();
const CACHE_TTL = 5 * 60 * 1000;

/**
 * Smart encoding that automatically detects content type and applies appropriate transformation
 */
export function smartEncode(
  data: any,
  config: TransformConfig = {},
): { data: any; metadata: TransformMetadata } {
  const startTime = performance.now();
  const originalSize = JSON.stringify(data).length;

  const cacheKey = generateCacheKey(data, config);
  const cached = transformCache.get(cacheKey);
  if (cached && cached.expiry > Date.now()) {
    return { data: cached.data, metadata: cached.metadata };
  }

  const transformedData = transformData(data, config, "encode");
  const encodedSize = JSON.stringify(transformedData).length;

  const metadata: TransformMetadata = {
    originalSize,
    encodedSize,
    compressionRatio: originalSize > 0 ? encodedSize / originalSize : 1,
    timestamp: Date.now(),
    fields: extractTransformedFields(data, config),
  };

  transformCache.set(cacheKey, {
    data: transformedData,
    metadata,
    expiry: Date.now() + CACHE_TTL,
  });

  if (process.env.NODE_ENV === "development") {
    const processingTime = performance.now() - startTime;
    console.log(
      `🔧 Encoding performance: ${processingTime.toFixed(2)}ms, compression: ${(metadata.compressionRatio * 100).toFixed(1)}%`,
    );
  }

  return { data: transformedData, metadata };
}

/**
 * Smart decoding that reverses the encoding process
 */
export function smartDecode(data: any, config: TransformConfig = {}): any {
  const startTime = performance.now();

  const cacheKey = generateCacheKey(data, config, "decode");
  const cached = transformCache.get(cacheKey);
  if (cached && cached.expiry > Date.now()) {
    return cached.data;
  }

  const decodedData = transformData(data, config, "decode");

  transformCache.set(cacheKey, {
    data: decodedData,
    metadata: {} as TransformMetadata,
    expiry: Date.now() + CACHE_TTL,
  });

  if (process.env.NODE_ENV === "development") {
    const processingTime = performance.now() - startTime;
    console.log(`🔍 Decoding performance: ${processingTime.toFixed(2)}ms`);
  }

  return decodedData;
}

/**
 * Core transformation logic for encoding and decoding operations
 */
function transformData(
  data: any,
  config: TransformConfig,
  operation: "encode" | "decode",
): any {
  if (!data || typeof data !== "object") {
    return data;
  }

  if (Array.isArray(data)) {
    return data.map((item) => transformData(item, config, operation));
  }

  const result: any = {};
  const { fields, exclude, deep = true } = config;

  for (const [key, value] of Object.entries(data)) {
    if (exclude?.includes(key)) {
      result[key] = value;
      continue;
    }

    if (shouldTransformField(key, value, fields)) {
      result[key] =
        operation === "encode" ? encodeValue(value) : decodeValue(value);
    } else if (deep && value && typeof value === "object") {
      result[key] = transformData(value, config, operation);
    } else {
      result[key] = value;
    }
  }

  return result;
}

/**
 * Determine if a field should be transformed based on configuration and content
 */
function shouldTransformField(
  key: string,
  value: any,
  fields?: string[],
): boolean {
  if (fields && fields.length > 0) {
    return fields.includes(key);
  }

  return (
    typeof value === "string" && value.length > 10 && !isAlreadyEncoded(value)
  );
}

/**
 * Check if a string is already Base64 encoded
 */
function isAlreadyEncoded(value: string): boolean {
  try {
    const decoded = atob(value);
    const reencoded = btoa(decoded);
    return reencoded === value;
  } catch {
    return false;
  }
}

/**
 * Encode a single value with optional compression for large strings
 */
function encodeValue(value: any): string {
  if (typeof value !== "string") {
    value = JSON.stringify(value);
  }

  const encoder = new TextEncoder();
  const encoded = encoder.encode(value);
  const base64 = btoa(String.fromCharCode(...Array.from(encoded)));

  if (value.length > 1000) {
    return compressAndEncode(value);
  }

  return base64;
}

/**
 * Decode a single value handling both compressed and standard encoding
 */
function decodeValue(value: any): any {
  if (typeof value !== "string") {
    return value;
  }

  try {
    if (value.startsWith("comp:")) {
      return decompressAndDecode(value);
    }

    const decoded = atob(value);

    try {
      return JSON.parse(decoded);
    } catch {
      return decoded;
    }
  } catch (error) {
    console.warn("Failed to decode value:", error);
    return value;
  }
}

/**
 * Compress large strings before encoding
 */
function compressAndEncode(value: string): string {
  return "comp:" + btoa(value);
}

/**
 * Decompress and decode compressed strings
 */
function decompressAndDecode(value: string): string {
  const withoutPrefix = value.substring(5);
  return atob(withoutPrefix);
}

/**
 * Generate unique cache key for transformation operations
 */
function generateCacheKey(
  data: any,
  config: TransformConfig,
  operation?: string,
): string {
  const configHash = JSON.stringify(config);
  const dataHash =
    typeof data === "string"
      ? data.substring(0, 50)
      : JSON.stringify(data).substring(0, 50);
  return `${operation || "transform"}_${btoa(configHash + dataHash)}`;
}

/**
 * Extract list of fields that were transformed
 */
function extractTransformedFields(
  data: any,
  config: TransformConfig,
): string[] {
  const fields: string[] = [];

  if (config.fields) {
    return config.fields;
  }

  if (data && typeof data === "object") {
    for (const [key, value] of Object.entries(data)) {
      if (shouldTransformField(key, value, config.fields)) {
        fields.push(key);
      }
    }
  }

  return fields;
}

/**
 * Clear transformation cache for memory management
 */
export function clearTransformCache(): void {
  transformCache.clear();
}

/**
 * Get cache statistics for monitoring
 */
export function getCacheStats() {
  return {
    size: transformCache.size,
    entries: Array.from(transformCache.keys()),
  };
}

/**
 * High-level API for common transformation use cases
 */
export const DataTransformer = {
  encodeForAPI: (data: any) =>
    smartEncode(data, {
      fields: [
        "introduction",
        "instructions",
        "gradingCriteriaOverview",
        "question",
        "content",
      ],
      deep: true,
    }),

  decodeFromAPI: (data: any) =>
    smartDecode(data, {
      fields: [
        "introduction",
        "instructions",
        "gradingCriteriaOverview",
        "question",
        "content",
      ],
      deep: true,
    }),

  encodeFormData: (data: any) =>
    smartEncode(data, {
      exclude: ["id", "createdAt", "updatedAt"],
      deep: false,
    }),

  encodeForStorage: (data: any) =>
    smartEncode(data, {
      compressionLevel: "heavy",
      deep: true,
    }),

  clearCache: clearTransformCache,
  getStats: getCacheStats,
};
