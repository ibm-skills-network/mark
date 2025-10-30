import type {
  API_ENCODE_CONFIG,
  API_DECODE_CONFIG,
  FORM_DATA_CONFIG,
  STORAGE_CONFIG,
} from "./transform-config";

export interface TransformConfig {
  fields?: string[];
  exclude?: string[];
  deep?: boolean;
  compressionLevel?: "none" | "light" | "heavy";
}

let _transformConfig:
  | {
      API_ENCODE_CONFIG: typeof API_ENCODE_CONFIG;
      API_DECODE_CONFIG: typeof API_DECODE_CONFIG;
      FORM_DATA_CONFIG: typeof FORM_DATA_CONFIG;
      STORAGE_CONFIG: typeof STORAGE_CONFIG;
    }
  | undefined;

function getTransformConfig() {
  if (!_transformConfig) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    _transformConfig = require("./transform-config");
  }
  return _transformConfig;
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
const BASE64_REGEX = /^[A-Za-z0-9+/]+=*$/;
const MAX_BASE64_DEPTH = 5;

/**
 * Check if a string contains mostly printable text
 * Used to validate that decoded base64 produces readable content
 */
function isPrintableText(value: string): boolean {
  if (!value) return true;

  let printableCount = 0;
  for (let index = 0; index < value.length; index += 1) {
    const charCode = value.charCodeAt(index);
    const isPrintable =
      charCode === 9 ||
      charCode === 10 ||
      charCode === 13 ||
      (charCode >= 32 && charCode !== 127);

    if (isPrintable) {
      printableCount += 1;
    }
  }

  return printableCount / value.length >= 0.85;
}

/**
 * Strictly validate and decode a base64 string
 * Returns decoded string only if:
 * 1. Input is valid base64 format
 * 2. Decoded content is printable text
 * 3. Re-encoding produces the same result (round-trip validation)
 */
function tryDecodeBase64(value: string): string | null {
  if (!value || typeof value !== "string") return null;

  const trimmed = value.trim();

  if (trimmed.length < 4) return null;

  if (!BASE64_REGEX.test(trimmed)) return null;

  const paddingNeeded = (4 - (trimmed.length % 4)) % 4;
  const padded = trimmed + "=".repeat(paddingNeeded);

  try {
    const binaryString = atob(padded);
    const bytes = new Uint8Array(binaryString.length);
    for (let index = 0; index < binaryString.length; index += 1) {
      bytes[index] = binaryString.charCodeAt(index);
    }
    const decoder = new TextDecoder();
    const decoded = decoder.decode(bytes);

    if (!isPrintableText(decoded)) {
      return null;
    }

    const encoder = new TextEncoder();
    const encodedBytes = encoder.encode(decoded);
    const binaryStr = Array.from(encodedBytes, (byte) =>
      String.fromCharCode(byte),
    ).join("");
    const reencoded = btoa(binaryStr).replace(/=+$/g, "");
    const normalizedInput = trimmed.replace(/=+$/g, "");

    return reencoded === normalizedInput ? decoded : null;
  } catch {
    return null;
  }
}

/**
 * Decode multiple layers of base64 encoding
 * Handles cases where data was encoded multiple times
 */
function decodeBase64Layers(value: string): string {
  if (!value || typeof value !== "string") return value;

  let current = value;
  let depth = 0;

  while (depth < MAX_BASE64_DEPTH) {
    const decoded = tryDecodeBase64(current);

    if (decoded === null || decoded === current) {
      break;
    }

    current = decoded;
    depth += 1;
  }

  return current;
}

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
  currentPath = "",
): any {
  if (data === null || data === undefined) {
    return data;
  }

  if (typeof data !== "object") {
    return data;
  }

  if (visited.has(data)) {
    return "[Circular]";
  }
  visited.add(data);

  if (Array.isArray(data)) {
    const transformedArray = data.map((item, index) =>
      transformData(
        item,
        config,
        operation,
        visited,
        `${currentPath}[${index}]`,
      ),
    );
    visited.delete(data);
    return transformedArray;
  }

  const result: any = {};
  const { fields, exclude, deep = true } = config;

  for (const [key, value] of Object.entries(data)) {
    const fieldPath = currentPath ? `${currentPath}.${key}` : key;

    if (exclude?.includes(key) || exclude?.includes(fieldPath)) {
      result[key] = value;
      continue;
    }

    if (typeof value === "string" && operation === "decode") {
      const parsed = tryParseJSON(value);
      if (parsed !== null && typeof parsed === "object") {
        result[key] = transformData(
          parsed,
          config,
          operation,
          visited,
          fieldPath,
        );
        continue;
      }
    }

    if (shouldTransformField(key, value, fields, fieldPath, operation)) {
      if (Array.isArray(value)) {
        result[key] = value.map((item, index) => {
          const childPath = `${fieldPath}[${index}]`;
          if (typeof item === "string") {
            return operation === "encode"
              ? encodeValue(item)
              : decodeValue(item);
          }
          if (item && typeof item === "object") {
            return transformData(item, config, operation, visited, childPath);
          }
          return item;
        });
      } else {
        result[key] =
          operation === "encode" ? encodeValue(value) : decodeValue(value);
      }
    } else if (deep && value && typeof value === "object") {
      result[key] = transformData(value, config, operation, visited, fieldPath);
    } else {
      result[key] = value;
    }
  }

  visited.delete(data);
  return result;
}

/**
 * Try to parse a string as JSON, return null if it fails
 */
function tryParseJSON(value: string): any {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

/**
 * Determine if a field should be transformed
 * Only transforms explicitly configured fields - no auto-detection
 */
function shouldTransformField(
  key: string,
  value: any,
  fields: string[] | undefined,
  fieldPath: string,
  operation: "encode" | "decode",
): boolean {
  if (!fields || fields.length === 0) {
    return false;
  }

  const isConfigured = matchesConfiguredField(fields, key, fieldPath);
  if (!isConfigured) {
    return false;
  }

  if (typeof value === "string") {
    const trimmedValue = value.trim();
    if (
      operation === "encode" &&
      /^\d+$/.test(trimmedValue) &&
      trimmedValue.length <= 10
    ) {
      return false;
    }
  }

  return true;
}

function normalizeFieldPath(path: string): string[] {
  return path
    .replace(/\[\d+\]/g, "")
    .split(".")
    .map((segment) => segment.trim())
    .filter(Boolean);
}

function matchesConfiguredField(
  configuredFields: string[],
  key: string,
  fieldPath: string,
): boolean {
  const candidateSegments = normalizeFieldPath(fieldPath);

  return configuredFields.some((field) => {
    const normalizedFieldSegments = normalizeFieldPath(field);

    if (
      normalizedFieldSegments.length === 1 &&
      normalizedFieldSegments[0] === key
    ) {
      return true;
    }

    if (normalizedFieldSegments.length !== candidateSegments.length) {
      return false;
    }

    return normalizedFieldSegments.every(
      (segment, index) => segment === candidateSegments[index],
    );
  });
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

  const binaryString = Array.from(encoded, (byte) =>
    String.fromCharCode(byte),
  ).join("");
  const base64 = btoa(binaryString);

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

  if (value.startsWith("comp:")) {
    try {
      const decoded = decompressAndDecode(value);
      const fullyDecoded = decodeBase64Layers(decoded);
      try {
        return JSON.parse(fullyDecoded);
      } catch {
        return fullyDecoded;
      }
    } catch (error) {
      return value;
    }
  }

  const fullyDecoded = decodeBase64Layers(value);
  if (fullyDecoded === value) {
    return value;
  }

  try {
    return JSON.parse(fullyDecoded);
  } catch {
    return fullyDecoded;
  }
}

/**
 * Compress large strings before encoding
 */
function compressAndEncode(value: string): string {
  const encoder = new TextEncoder();
  const encoded = encoder.encode(value);

  const binaryString = Array.from(encoded, (byte) =>
    String.fromCharCode(byte),
  ).join("");
  const base64 = btoa(binaryString);
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

  const encoder = new TextEncoder();
  const encoded = encoder.encode(configHash + dataHash);

  const binaryString = Array.from(encoded, (byte) =>
    String.fromCharCode(byte),
  ).join("");
  const base64 = btoa(binaryString);

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
      if (shouldTransformField(key, value, config.fields, key, "encode")) {
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
    const { API_ENCODE_CONFIG } = getTransformConfig();
    const result = smartEncode(data, config || API_ENCODE_CONFIG);
    return result;
  },

  decodeFromAPI: (data: any, config?: TransformConfig) => {
    const { API_DECODE_CONFIG } = getTransformConfig();
    const result = smartDecode(data, config || API_DECODE_CONFIG);
    return result;
  },

  encodeFormData: (data: any, config?: TransformConfig) => {
    const { FORM_DATA_CONFIG } = getTransformConfig();
    return smartEncode(data, config || FORM_DATA_CONFIG);
  },

  encodeForStorage: (data: any, config?: TransformConfig) => {
    const { STORAGE_CONFIG } = getTransformConfig();
    return smartEncode(data, config || STORAGE_CONFIG);
  },

  clearCache: clearTransformCache,
  getStats: getCacheStats,
};
