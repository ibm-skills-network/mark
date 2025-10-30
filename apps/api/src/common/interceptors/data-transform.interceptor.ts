import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { Observable } from "rxjs";
import { map } from "rxjs/operators";
import { TRANSFORM_FIELDS } from "../../helpers/transform-config";

export interface TransformOptions {
  fields?: string[];
  exclude?: string[];
  encodeResponse?: boolean;
  decodeRequest?: boolean;
  deep?: boolean;
}

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

export const TRANSFORM_METADATA_KEY = "data-transform";

const BASE64_REGEX = /^[\d+/A-Za-z]+=*$/;
const MAX_BASE64_DEPTH = 5;

/**
 * Decorator to configure data transformation for endpoints
 */
export const DataTransform = (
  options: TransformOptions = {},
): MethodDecorator => Reflect.metadata(TRANSFORM_METADATA_KEY, options);

/**
 * NestJS interceptor for automatic request/response data transformation
 */
@Injectable()
export class DataTransformInterceptor implements NestInterceptor {
  constructor(private reflector: Reflector) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const options = this.getTransformOptions(context);

    if (!options) {
      return next.handle();
    }

    this.transformRequest(context, options);

    return next
      .handle()
      .pipe(map((data: unknown) => this.transformResponse(data, options)));
  }

  /**
   * Get transformation options from decorator or use defaults
   */
  private getTransformOptions(
    context: ExecutionContext,
  ): TransformOptions | null {
    const options = this.reflector.getAllAndOverride<TransformOptions>(
      TRANSFORM_METADATA_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (options === undefined) {
      return {
        encodeResponse: true,
        decodeRequest: true,
        fields: [...TRANSFORM_FIELDS],
        deep: true,
      };
    }

    return options;
  }

  /**
   * Transform incoming request data by decoding fields
   */
  private transformRequest(
    context: ExecutionContext,
    options: TransformOptions,
  ): void {
    if (!options.decodeRequest) return;

    // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
    const request = context.switchToHttp().getRequest() as {
      body?: Record<string, unknown>;
      query?: Record<string, unknown>;
    };

    if (request.body && typeof request.body === "object") {
      request.body = this.transformData(
        request.body,
        options,
        "decode",
      ) as Record<string, unknown>;
    }

    if (request.query && typeof request.query === "object") {
      request.query = this.transformData(
        request.query,
        options,
        "decode",
      ) as Record<string, unknown>;
    }
  }

  /**
   * Transform outgoing response data by encoding fields
   */
  private transformResponse(data: unknown, options: TransformOptions): unknown {
    if (!options.encodeResponse || !data) return data;

    const result = this.transformData(data, options, "encode");
    return result;
  }

  /**
   * Core transformation logic for both encoding and decoding
   */
  private transformData(
    data: unknown,
    options: TransformOptions,
    operation: "encode" | "decode",
    currentPath = "",
  ): unknown {
    if (data === null || typeof data !== "object") return data;

    if (Array.isArray(data)) {
      return data.map((item: unknown, index: number) =>
        this.transformData(
          item,
          options,
          operation,
          `${currentPath}[${index}]`,
        ),
      );
    }

    const result: Record<string, unknown> = {};
    const { fields, exclude, deep = true } = options;

    for (const [key, value] of Object.entries(
      data as Record<string, unknown>,
    )) {
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
              return this.transformData(item, options, operation, childPath);
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
      } else if (deep && value && typeof value === "object") {
        result[key] = this.transformData(value, options, operation, fieldPath);
      } else {
        result[key] = value;
      }
    }

    return result;
  }

  /**
   * Determine if a field should be transformed
   * Only transforms explicitly configured fields - no auto-detection
   */
  private shouldTransformField(
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
   * Encode a single value
   */
  private encodeValue(value: unknown): string {
    const stringValue =
      typeof value === "string" ? value : JSON.stringify(value);
    return Buffer.from(stringValue).toString("base64");
  }

  /**
   * Decode a single value
   */
  private decodeValue(value: unknown): unknown {
    if (typeof value !== "string") return value;

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
}
