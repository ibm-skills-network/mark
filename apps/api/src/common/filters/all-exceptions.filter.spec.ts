import { HttpStatus } from "@nestjs/common";
import { LlmQuotaExceededError } from "../../api/llm/core/utils/llm-error.util";
import { AllExceptionsFilter } from "./all-exceptions.filter";

describe("AllExceptionsFilter — LLM quota mapping", () => {
  const logger = { warn: jest.fn(), error: jest.fn() };
  const parentLogger = { child: jest.fn().mockReturnValue(logger) };
  const circuitBreaker = { getStats: jest.fn() };

  const makeHost = () => {
    const response = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
      setHeader: jest.fn(),
      headersSent: false,
    };
    const request = {
      method: "POST",
      originalUrl: "/api/v2/assignments/1/questions/2/translations",
      get: jest.fn().mockReturnValue(undefined),
      body: {},
    };
    const host = {
      switchToHttp: () => ({
        getRequest: () => request,
        getResponse: () => response,
      }),
    };
    return { host, response };
  };

  const makeFilter = () =>
    new AllExceptionsFilter(parentLogger as any, circuitBreaker as any);

  beforeEach(() => jest.clearAllMocks());

  it("maps LlmQuotaExceededError to 503 with Retry-After and a structured body", () => {
    const { host, response } = makeHost();

    makeFilter().catch(
      new LlmQuotaExceededError("LLM temporarily unavailable", {
        retryAfterSeconds: 63,
      }),
      host as any,
    );

    expect(response.status).toHaveBeenCalledWith(
      HttpStatus.SERVICE_UNAVAILABLE,
    );
    expect(response.setHeader).toHaveBeenCalledWith("Retry-After", "63");
    expect(response.json).toHaveBeenCalledWith({
      statusCode: HttpStatus.SERVICE_UNAVAILABLE,
      code: "LLM_UNAVAILABLE",
      message: "LLM temporarily unavailable",
      retryAfterSeconds: 63,
    });
    // Expected, handled degradation — logged at warn, not as an unhandled 5xx.
    expect(logger.warn).toHaveBeenCalled();
    expect(logger.error).not.toHaveBeenCalled();
  });
});
