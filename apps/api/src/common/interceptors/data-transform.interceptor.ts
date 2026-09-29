import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { Observable } from "rxjs";
import { map } from "rxjs/operators";
import { decodeValue as decodeTransportValue } from "../../helpers/data-transformer";
import { TRANSFORM_FIELDS } from "../../helpers/transform-config";

export interface TransformOptions {
  fields?: string[];
  exclude?: string[];
  encodeResponse?: boolean;
  decodeRequest?: boolean;
  deep?: boolean;
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
      const transformedQuery = this.transformData(
        request.query,
        options,
        "decode",
      ) as Record<string, unknown>;
      // Express 5 exposes `req.query` as a getter-only property — direct
      // assignment throws. Replace the descriptor instead so the rest of
      // the request pipeline sees the transformed values.
      Object.defineProperty(request, "query", {
        value: transformedQuery,
        writable: true,
        configurable: true,
        enumerable: true,
      });
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
                : this.decodeValue(item, false);
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
   * Decode a single value. Shares the helper's rules so a request body and a
   * stored record read the same text the same way.
   */
  private decodeValue(value: unknown, allowStructured = true): unknown {
    return decodeTransportValue(value, allowStructured);
  }
}
