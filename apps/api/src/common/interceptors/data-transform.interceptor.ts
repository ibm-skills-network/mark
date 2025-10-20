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
  ): unknown {
    if (!data || typeof data !== "object") return data;

    if (Array.isArray(data)) {
      return data.map((item: unknown) =>
        this.transformData(item, options, operation),
      );
    }

    const result: Record<string, unknown> = {};
    const { fields, exclude, deep = true } = options;

    for (const [key, value] of Object.entries(
      data as Record<string, unknown>,
    )) {
      if (exclude?.includes(key)) {
        result[key] = value;
        continue;
      }

      if (this.shouldTransformField(key, value, fields)) {
        result[key] =
          operation === "encode"
            ? this.encodeValue(value)
            : this.decodeValue(value);
      } else if (deep && value && typeof value === "object") {
        result[key] = this.transformData(value, options, operation);
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
    fields?: string[],
  ): boolean {
    if (fields && fields.length > 0) {
      return fields.includes(key);
    }

    return typeof value === "string" && value.length > 10;
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
}
