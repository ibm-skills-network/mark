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
const HTML_TAG_REGEX = /<\/?[a-z][\s\S]*>/i;
const BASE64_FULL_REGEX = /^[A-Za-z0-9+/]+={0,2}$/;
const BASE64_SEGMENT_REGEX = /[A-Za-z0-9+/=]{12,}/g;
const MAX_BASE64_DEPTH = 5;

interface Base64Payload {
  candidate: string;
  decoded: string;
}

function padBase64(value: string): string {
  const remainder = value.length % 4;
  if (remainder === 0) return value;
  return value + "=".repeat(4 - remainder);
}

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

function decodeBase64String(value: string): string | null {
  try {
    const binaryString = atob(value);
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
    const reencoded = btoa(
      String.fromCharCode(...Array.from(encoder.encode(decoded))),
    ).replace(/=+$/g, "");
    const normalizedInput = value.replace(/=+$/g, "");

    return reencoded === normalizedInput ? decoded : null;
  } catch {
    return null;
  }
}

function findBase64Payload(rawValue: string): Base64Payload | null {
  if (!rawValue) return null;

  const trimmed = rawValue.trim();
  if (!trimmed) return null;

  const primaryCandidate =
    trimmed.length >= 8 &&
    BASE64_FULL_REGEX.test(trimmed) &&
    decodeBase64String(trimmed);

  if (typeof primaryCandidate === "string") {
    return { candidate: trimmed, decoded: primaryCandidate };
  }

  const matches = trimmed.match(BASE64_SEGMENT_REGEX);
  if (!matches) return null;

  for (const match of matches) {
    if (!match) continue;
    const padded = padBase64(match);
    const decoded = decodeBase64String(padded);
    if (decoded !== null) {
      return { candidate: padded, decoded };
    }
  }

  return null;
}

function decodeBase64Layers(value: string): string {
  let current = value;
  let depth = 0;

  while (depth < MAX_BASE64_DEPTH) {
    const payload = findBase64Payload(current);
    if (!payload) break;

    const decoded = payload.decoded;
    if (decoded === current) break;

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
 * Determine if a field should be transformed based on configuration and content
 */
function shouldTransformField(
  key: string,
  value: any,
  fields: string[] | undefined,
  fieldPath: string,
  operation: "encode" | "decode",
): boolean {
  if (fields && fields.length > 0) {
    return matchesConfiguredField(fields, key, fieldPath);
  }

  if (typeof value !== "string") {
    return false;
  }

  const trimmedValue = value.trim();
  const containsHtmlTags = HTML_TAG_REGEX.test(trimmedValue);
  const base64Payload = findBase64Payload(value);

  if (operation === "encode") {
    const alreadyEncoded =
      base64Payload !== null && base64Payload.candidate === trimmedValue;

    return !alreadyEncoded && (value.length > 10 || containsHtmlTags);
  }

  return base64Payload !== null;
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
 * Check if a string is already Base64 encoded
 */
function isAlreadyEncoded(value: string): boolean {
  if (!value || typeof value !== "string") return false;

  const trimmed = value.trim();
  if (
    !trimmed ||
    trimmed.length % 4 !== 0 ||
    !BASE64_FULL_REGEX.test(trimmed)
  ) {
    return false;
  }

  return decodeBase64String(trimmed) !== null;
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
      console.warn("Failed to decode compressed value:", error);
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
