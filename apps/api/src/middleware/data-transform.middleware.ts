import { Injectable, NestMiddleware } from "@nestjs/common";
import { NextFunction, Request, Response } from "express";

interface TransformConfig {
  encodeRequests?: boolean;
  decodeResponses?: boolean;
  fields?: string[];
  exclude?: string[];
  routes?: {
    include?: string[];
    exclude?: string[];
  };
}

type TransformOperation = "encode" | "decode";

interface TransformableData {
  [key: string]: unknown;
}

type QueryData = Record<string, string | string[] | undefined>;

const HTML_TAG_REGEX = /<\/?[a-z][\S\s]*>/i;
const BASE64_FULL_REGEX = /^[\d+/A-Za-z]+={0,2}$/;
const BASE64_SEGMENT_REGEX = /[\d+/=A-Za-z]{12,}/g;
const MAX_BASE64_DEPTH = 5;

interface Base64Payload {
  candidate: string;
  decoded: string;
}

/**
 * Backend API middleware for automatic data transformation
 * Decodes incoming requests and encodes outgoing responses
 */
@Injectable()
export class DataTransformMiddleware implements NestMiddleware {
  private config: TransformConfig = {
    encodeRequests: true, // Don't encode outgoing requests (backend doesn't make requests)
    decodeResponses: true, // Don't decode incoming responses (backend doesn't receive responses)
    fields: [
      "introduction",
      "instructions",
      "gradingCriteriaOverview",
      "question",
      "content",
      "rubricQuestion",
      "description",
      "questions.scoring.rubrics.rubricQuestion",
      "questions.scoring.rubrics.criteria.description",
      "learnerTextResponse",
      "learnerChoices",
    ],
    exclude: ["id", "createdAt", "updatedAt"],
    routes: {
      exclude: ["/health", "/api-docs"],
    },
  };

  use(request: Request, response: Response, next: NextFunction) {
    if (!this.shouldTransform(request.path)) {
      return next();
    }

    this.transformRequest(request);
    this.interceptResponse(response);

    next();
  }

  /**
   * Check if the route should be transformed
   */
  private shouldTransform(path: string): boolean {
    const { routes } = this.config;

    if (routes?.exclude?.some((excludePath) => path.startsWith(excludePath))) {
      return false;
    }

    if (routes?.include && routes.include.length > 0) {
      return routes.include.some((includePath) => path.startsWith(includePath));
    }

    return true;
  }

  /**
   * Transform incoming request data - DECODE for backend
   */
  private transformRequest(request: Request): void {
    if (!request.body) return;

    try {
      request.body = this.transformData(
        request.body as TransformableData,
        "decode",
      );

      if (request.query && Object.keys(request.query).length > 0) {
        const transformedQuery = this.transformData(
          request.query as TransformableData,
          "decode",
        ) as QueryData;
        request.query = transformedQuery;
      }
    } catch (error) {
      console.error("Error transforming request data:", error);
    }
  }

  /**
   * Intercept and transform response data - ENCODE for backend
   */
  private interceptResponse(response: Response): void {
    const originalJson = response.json;

    response.json = function (data: TransformableData) {
      try {
        const middleware = (
          response.locals as {
            middleware?: {
              transformData: (
                data: TransformableData,
                operation: TransformOperation,
              ) => TransformableData;
            };
          }
        )?.middleware;

        if (middleware) {
          const transformedData = middleware.transformData(data, "encode");
          return originalJson.call(
            this,
            transformedData,
          ) as Response<TransformableData>;
        }
        return originalJson.call(this, data) as Response<TransformableData>;
      } catch (error) {
        console.error("Error transforming response data:", error);
        return originalJson.call(this, data) as Response<TransformableData>;
      }
    };

    response.locals = {
      ...response.locals,
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      middleware: { transformData: this.transformData.bind(this) },
    };
  }

  /**
   * Core data transformation logic
   */
  private transformData(
    data: TransformableData,
    operation: TransformOperation,
    currentPath = "",
  ): TransformableData {
    if (data === null || typeof data !== "object") return data;

    if (Array.isArray(data)) {
      return data.map((item, index) =>
        this.transformData(
          item as TransformableData,
          operation,
          `${currentPath}[${index}]`,
        ),
      ) as unknown as TransformableData;
    }

    const result: TransformableData = {};
    const { fields, exclude } = this.config;

    for (const [key, value] of Object.entries(
      data as Record<string, unknown>,
    )) {
      if (exclude?.includes(key)) {
        result[key] = value;
        continue;
      }

      const fieldPath = currentPath ? `${currentPath}.${key}` : key;

      if (exclude?.includes(key) || exclude?.includes(fieldPath)) {
        result[key] = value;
        continue;
      }

      if (this.shouldTransformField(key, value, fields, fieldPath, operation)) {
        if (Array.isArray(value)) {
          result[key] = value.map((item, index) => {
            const childPath = `${fieldPath}[${index}]`;
            if (typeof item === "string") {
              return operation === "encode"
                ? this.encodeValue(item)
                : this.decodeValue(item);
            }
            if (item && typeof item === "object") {
              return this.transformData(
                item as TransformableData,
                operation,
                childPath,
              );
            }
            // eslint-disable-next-line @typescript-eslint/no-unsafe-return
            return item;
          });
        } else {
          result[key] =
            operation === "encode"
              ? this.encodeValue(value)
              : this.decodeValue(value);
        }
      } else if (value && typeof value === "object") {
        result[key] = this.transformData(
          value as TransformableData,
          operation,
          fieldPath,
        );
      } else {
        result[key] = value;
      }
    }

    return result;
  }

  /**
   * Check if a field should be transformed
   */
  private shouldTransformField(
    key: string,
    value: unknown,
    fields: string[] | undefined,
    fieldPath: string,
    operation: TransformOperation,
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
   * Encode a value using Base64
   */
  private encodeValue(value: unknown): string {
    const stringValue =
      typeof value === "string" ? value : JSON.stringify(value);
    return Buffer.from(stringValue, "utf8").toString("base64");
  }

  /**
   * Decode a Base64 encoded value
   */
  private decodeValue(value: unknown): unknown {
    if (typeof value !== "string") return value;

    // Handle compressed payloads with the 'comp:' prefix (matches web encoder)
    if (value.startsWith("comp:")) {
      try {
        const base64Data = value.slice(5); // strip 'comp:'
        const decoded = Buffer.from(base64Data, "base64").toString("utf8");
        const fullyDecoded = decodeBase64Layers(decoded);
        try {
          return JSON.parse(fullyDecoded) as unknown;
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
      return JSON.parse(fullyDecoded) as unknown;
    } catch {
      return fullyDecoded;
    }
  }

  /**
   * Update middleware configuration
   */
  updateConfig(newConfig: Partial<TransformConfig>): void {
    this.config = { ...this.config, ...newConfig };
  }
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

function normalizeFieldPath(path: string): string[] {
  return path
    .replaceAll(/\[\d+]/g, "")
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
 * Factory function to create middleware with custom configuration
 */
export function createDataTransformMiddleware(
  config: TransformConfig = {},
): typeof DataTransformMiddleware {
  return class ConfiguredDataTransformMiddleware extends DataTransformMiddleware {
    constructor() {
      super();
      this.updateConfig(config);
    }
  };
}
