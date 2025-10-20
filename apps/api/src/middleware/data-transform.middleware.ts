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
  ): TransformableData {
    if (!data || typeof data !== "object") return data;

    if (Array.isArray(data)) {
      return data.map((item) =>
        this.transformData(item as TransformableData, operation),
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

      if (this.shouldTransformField(key, value, fields)) {
        result[key] =
          operation === "encode"
            ? this.encodeValue(value)
            : this.decodeValue(value);
      } else if (value && typeof value === "object") {
        result[key] = this.transformData(value as TransformableData, operation);
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
    fields?: string[],
  ): boolean {
    if (fields && fields.length > 0) {
      return fields.includes(key);
    }

    return typeof value === "string" && value.length > 10;
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

    try {
      const decoded = Buffer.from(value, "base64").toString("utf8");

      try {
        return JSON.parse(decoded) as unknown;
      } catch {
        return decoded;
      }
    } catch {
      return value;
    }
  }

  /**
   * Update middleware configuration
   */
  updateConfig(newConfig: Partial<TransformConfig>): void {
    this.config = { ...this.config, ...newConfig };
  }
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
