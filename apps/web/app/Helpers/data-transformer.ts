export interface TransformConfig {
  fields?: string[];
  exclude?: string[];
  deep?: boolean;
  compressionLevel?: "none" | "light" | "heavy";
}

export interface TransformMetadata {
  originalSize: number;
  encodedSize: number;
  transformedSize: number;
  compressionRatio: number;
  timestamp: number;
  fields: string[];
  transformedFields?: string[];
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
  const originalSize = safeStringify(data).length;

  const cacheKey = generateCacheKey(data, config);
  const cached = transformCache.get(cacheKey);
  if (cached && cached.expiry > Date.now()) {
    return { data: cached.data, metadata: cached.metadata };
  }

  const transformedData = transformData(data, config, "encode");
  const encodedSize = safeStringify(transformedData).length;

  const transformedFields = extractTransformedFields(data, config);
  const metadata: TransformMetadata = {
    originalSize,
    encodedSize,
    transformedSize: encodedSize,
    compressionRatio: originalSize > 0 ? encodedSize / originalSize : 1,
    timestamp: Date.now(),
    fields: transformedFields,
    transformedFields: transformedFields,
  };

  transformCache.set(cacheKey, {
    data: transformedData,
    metadata,
    expiry: Date.now() + CACHE_TTL,
  });

  return { data: transformedData, metadata };
}

/**
 * Smart decoding that reverses the encoding process
 */
export function smartDecode(data: any, config: TransformConfig = {}): any {
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

  return decodedData;
}

/**
 * Core transformation logic for encoding and decoding operations
 */
function transformData(
  data: any,
  config: TransformConfig,
  operation: "encode" | "decode",
  visited: WeakSet<object> = new WeakSet(),
): any {
  if (!data || typeof data !== "object") {
    return data;
  }

  // Check for circular references
  if (visited.has(data)) {
    return "[Circular]";
  }
  visited.add(data);

  if (Array.isArray(data)) {
    return data.map((item) => transformData(item, config, operation, visited));
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
      result[key] = transformData(value, config, operation, visited);
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
  if (value === null || value === undefined) {
    return value;
  }

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

    const binaryString = atob(value);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    const decoder = new TextDecoder();
    const decoded = decoder.decode(bytes);

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
  const encoder = new TextEncoder();
  const encoded = encoder.encode(value);
  const base64 = btoa(String.fromCharCode(...Array.from(encoded)));
  return "comp:" + base64;
}

/**
 * Decompress and decode compressed strings
 */
function decompressAndDecode(value: string): string {
  const withoutPrefix = value.substring(5);
  const binaryString = atob(withoutPrefix);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  const decoder = new TextDecoder();
  return decoder.decode(bytes);
}

/**
 * Safely stringify data, handling circular references
 */
function safeStringify(data: any): string {
  const seen = new WeakSet();
  return JSON.stringify(data, (_key, value) => {
    if (typeof value === "object" && value !== null) {
      if (seen.has(value)) {
        return "[Circular]";
      }
      seen.add(value);
    }
    return value;
  });
}

/**
 * Generate unique cache key for transformation operations
 */
function generateCacheKey(
  data: any,
  config: TransformConfig,
  operation?: string,
): string {
  const configHash = safeStringify(config);
  const dataHash =
    typeof data === "string"
      ? data.substring(0, 50)
      : safeStringify(data).substring(0, 50);

  // Use TextEncoder to handle Unicode characters properly before base64 encoding
  const encoder = new TextEncoder();
  const encoded = encoder.encode(configHash + dataHash);
  const base64 = btoa(String.fromCharCode(...Array.from(encoded)));

  return `${operation || "transform"}_${base64}`;
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
  encodeForAPI: (data: any, config?: TransformConfig) => {
    const defaultConfig = {
      fields: [
        "introduction",
        "instructions",
        "gradingCriteriaOverview",
        "question",
        "content",
        "rubricQuestion",
        "description",
        "questions.choices.choice",
        "questions.scoring.rubrics.rubricQuestion",
        "questions.scoring.rubrics.criteria.description",
        "learnerTextResponse",
        "learnerChoices",
      ],
      deep: true,
    };
    const result = smartEncode(data, config || defaultConfig);
    return result;
  },

  decodeFromAPI: (data: any, config?: TransformConfig) => {
    const defaultConfig = {
      fields: [
        "introduction",
        "instructions",
        "gradingCriteriaOverview",
        "question",
        "content",
        "rubricQuestion",
        "questions.choices",
        "questionVersions.choices",
        "questionVersions.question",
        "description",
        "questions.choices.choice",
        "questions.scoring.rubrics.rubricQuestion",
        "questions.scoring.rubrics.criteria.description",
      ],
      deep: true,
    };
    const result = smartDecode(data, config || defaultConfig);
    return result;
  },

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
