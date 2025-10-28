import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { Observable } from "rxjs";
import { map } from "rxjs/operators";

export interface TransformOptions {
  fields?: string[];
  exclude?: string[];
  encodeResponse?: boolean;
  decodeRequest?: boolean;
  deep?: boolean;
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

export const TRANSFORM_METADATA_KEY = "data-transform";

const HTML_TAG_REGEX = /<\/?[a-z][\S\s]*>/i;
const BASE64_FULL_REGEX = /^[\d+/A-Za-z]+={0,2}$/;
const BASE64_SEGMENT_REGEX = /[\d+/=A-Za-z]{12,}/g;
const MAX_BASE64_DEPTH = 5;

interface Base64Payload {
  candidate: string;
  decoded: string;
}

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
   */
  private shouldTransformField(
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

    // Handle compressed data with 'comp:' prefix
    if (value.startsWith("comp:")) {
      try {
        const base64Data = value.slice(5); // Remove 'comp:' prefix
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
