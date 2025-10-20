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

      if (shouldTransformField(key, value, fields, fieldPath)) {
        result[key] =
          operation === "encode" ? encodeValue(value) : decodeValue(value);
        transformedFields.push(fieldPath);
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
  fields?: string[],
  fieldPath?: string,
): boolean {
  if (fields && fields.length > 0) {
    return fields.includes(key) || (fieldPath && fields.includes(fieldPath));
  }

  return (
    typeof value === "string" && value.length > 10 && !isBase64Encoded(value)
  );
}

/**
 * Check if a string is already Base64 encoded
 */
function isBase64Encoded(value: string): boolean {
  if (!value || typeof value !== "string") return false;

  try {
    const decoded = Buffer.from(value, "base64").toString("utf8");
    const reencoded = Buffer.from(decoded, "utf8").toString("base64");
    return reencoded === value;
  } catch {
    return false;
  }
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

  try {
    const decoded = Buffer.from(value, "base64").toString("utf8");

    try {
      return JSON.parse(decoded);
    } catch {
      return decoded;
    }
  } catch {
    return value;
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

/**
 * Utility functions for common use cases
 */
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
