export interface TransformConfig {
  fields?: string[];
  exclude?: string[];
  deep?: boolean;
  preserveTypes?: boolean;
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

const HTML_TAG_REGEX = /<\/?[a-z][\S\s]*>/i;
const BASE64_FULL_REGEX = /^[\d+/A-Za-z]+={0,2}$/;
const BASE64_SEGMENT_REGEX = /[\d+/=A-Za-z]{12,}/g;
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

function decodeBase64String(value: string): string | null {
  try {
    const decoded = Buffer.from(value, "base64").toString("utf8");
    if (!isPrintableText(decoded)) {
      return null;
    }

    const normalizedInput = value.replaceAll(/=+$/g, "");
    const reencoded = Buffer.from(decoded, "utf8")
      .toString("base64")
      .replaceAll(/=+$/g, "");

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
 */
function shouldTransformField(
  key: string,
  value: unknown,
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
  encodeForDatabase: <T>(data: T) => {
    const result = smartEncode(data, {
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
    });
    return result;
  },

  decodeFromDatabase: <T>(data: T) => {
    const result = smartDecode(data, {
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
    });
    return result;
  },

  encodeForAPI: <T>(data: T) =>
    smartEncode(data, {
      exclude: ["id", "createdAt", "updatedAt"],
      deep: true,
    }),

  decodeFromAPI: <T>(data: T) =>
    smartDecode(data, {
      exclude: ["id", "createdAt", "updatedAt"],
      deep: true,
    }),

  batchEncode,
  batchDecode,
};
