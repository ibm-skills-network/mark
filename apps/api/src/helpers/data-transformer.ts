import type { API_CONFIG, DATABASE_CONFIG } from "./transform-config";

export interface TransformConfig {
  fields?: string[];
  exclude?: string[];
  deep?: boolean;
  preserveTypes?: boolean;
}

let _transformConfig:
  | {
      DATABASE_CONFIG: typeof DATABASE_CONFIG;
      API_CONFIG: typeof API_CONFIG;
    }
  | undefined;

function getTransformConfig() {
  if (!_transformConfig) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-unsafe-assignment, unicorn/prefer-module
    _transformConfig = require("./transform-config");
  }
  return _transformConfig;
}

export interface TransformResult<T = any> {
  data: T;
  metadata: {
    transformedFields: string[];
    originalSize: number;
    transformedSize: number;
    timestamp: number;
  };
}

const BASE64_REGEX = /^[\d+/A-Za-z]+=*$/;
const MAX_BASE64_DEPTH = 5;

/**
 * Check if a string contains mostly printable text
 * Used to validate that decoded base64 produces readable content
 */
function isPrintableText(value: string): boolean {
  if (!value) return true;

  let printableCount = 0;
  for (let index = 0; index < value.length; index += 1) {
    const charCode = value.codePointAt(index);
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
    const decoded = Buffer.from(padded, "base64").toString("utf8");

    if (!isPrintableText(decoded)) {
      return null;
    }

    const normalizedInput = trimmed.replaceAll(/=+$/g, "");
    const reencoded = Buffer.from(decoded, "utf8")
      .toString("base64")
      .replaceAll(/=+$/g, "");

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
 * Smart data encoder that handles various data types and structures
 */
export function smartEncode<T = any>(
  data: T,
  config: TransformConfig = {},
): TransformResult<T> {
  const originalSize = JSON.stringify(data).length;
  const transformedFields: string[] = [];

  const transformedData = transformDataRecursive(
    data,
    config,
    "encode",
    transformedFields,
  ) as T;

  const transformedSize = JSON.stringify(transformedData).length;

  return {
    data: transformedData,
    metadata: {
      transformedFields,
      originalSize,
      transformedSize,
      timestamp: Date.now(),
    },
  };
}

/**
 * Smart data decoder that reverses the encoding process
 */
export function smartDecode<T = any>(data: T, config: TransformConfig = {}): T {
  const transformedFields: string[] = [];
  return transformDataRecursive(data, config, "decode", transformedFields) as T;
}

/**
 * Recursive data transformation for nested objects and arrays
 */
function transformDataRecursive(
  data: unknown,
  config: TransformConfig,
  operation: "encode" | "decode",
  transformedFields: string[],
  currentPath = "",
): unknown {
  if (data === null || data === undefined) return data;

  if (Array.isArray(data)) {
    return data.map((item: unknown, index: number) =>
      transformDataRecursive(
        item,
        config,
        operation,
        transformedFields,
        `${currentPath}[${index}]`,
      ),
    );
  }

  if (data && typeof data === "object") {
    const result: Record<string, unknown> = {};
    const { fields, exclude, deep = true } = config;

    for (const [key, value] of Object.entries(
      data as Record<string, unknown>,
    )) {
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
              transformedFields.push(childPath);
              return operation === "encode"
                ? encodeValue(item)
                : decodeValue(item);
            }
            if (item && typeof item === "object") {
              return transformDataRecursive(
                item,
                config,
                operation,
                transformedFields,
                childPath,
              );
            }
            // eslint-disable-next-line @typescript-eslint/no-unsafe-return
            return item;
          });
          transformedFields.push(fieldPath);
        } else {
          result[key] =
            operation === "encode" ? encodeValue(value) : decodeValue(value);
          transformedFields.push(fieldPath);
        }
      } else if (deep && value && typeof value === "object") {
        result[key] = transformDataRecursive(
          value,
          config,
          operation,
          transformedFields,
          fieldPath,
        );
      } else {
        result[key] = value;
      }
    }

    return result;
  }

  return data;
}

/**
 * Determine if a field should be transformed
 * Only transforms explicitly configured fields - no auto-detection
 */
function shouldTransformField(
  key: string,
  value: unknown,
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

/**
 * Normalize a field path by removing array indices and splitting into segments
 */
function normalizeFieldPath(path: string): string[] {
  return path
    .replaceAll(/\[\d+]/g, "")
    .split(".")
    .map((segment) => segment.trim())
    .filter(Boolean);
}

/**
 * Check if the current field matches any configured fields
 */
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
function isBase64Encoded(value: string): boolean {
  return tryDecodeBase64(value) !== null;
}

/**
 * Encode a single value with type preservation
 */
function encodeValue(value: unknown): string {
  if (value === null || value === undefined) return value as string;

  const stringValue = typeof value === "string" ? value : JSON.stringify(value);

  return Buffer.from(stringValue, "utf8").toString("base64");
}

/**
 * Decode a single value with automatic type detection
 */
function decodeValue(value: unknown): unknown {
  if (!value || typeof value !== "string") return value;

  if (value.startsWith("comp:")) {
    try {
      const base64Data = value.slice(5);
      const decoded = Buffer.from(base64Data, "base64").toString("utf8");
      const fullyDecoded = decodeBase64Layers(decoded);
      try {
        return JSON.parse(fullyDecoded);
      } catch {
        return fullyDecoded;
      }
    } catch {
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
 * Batch encode multiple data objects
 */
export function batchEncode<T = any>(
  dataArray: T[],
  config: TransformConfig = {},
): TransformResult<T[]> {
  const results = dataArray.map((data) => smartEncode(data, config));

  return {
    data: results.map((r) => r.data),
    metadata: {
      transformedFields: [
        ...new Set(results.flatMap((r) => r.metadata.transformedFields)),
      ],
      originalSize: results.reduce(
        (sum, r) => sum + r.metadata.originalSize,
        0,
      ),
      transformedSize: results.reduce(
        (sum, r) => sum + r.metadata.transformedSize,
        0,
      ),
      timestamp: Date.now(),
    },
  };
}

/**
 * Batch decode multiple data objects
 */
export function batchDecode<T = any>(
  dataArray: T[],
  config: TransformConfig = {},
): T[] {
  return dataArray.map((data) => smartDecode(data, config));
}

export const DataTransformer = {
  encodeForDatabase: <T>(data: T, config?: TransformConfig) => {
    const { DATABASE_CONFIG } = getTransformConfig();
    const result = smartEncode(data, config || DATABASE_CONFIG);
    return result;
  },

  decodeFromDatabase: <T>(data: T, config?: TransformConfig) => {
    const { DATABASE_CONFIG } = getTransformConfig();
    const result = smartDecode(data, config || DATABASE_CONFIG);
    return result;
  },

  encodeForAPI: <T>(data: T, config?: TransformConfig) => {
    const { API_CONFIG } = getTransformConfig();
    return smartEncode(data, config || API_CONFIG);
  },

  decodeFromAPI: <T>(data: T, config?: TransformConfig) => {
    const { API_CONFIG } = getTransformConfig();
    return smartDecode(data, config || API_CONFIG);
  },

  batchEncode,
  batchDecode,
};
