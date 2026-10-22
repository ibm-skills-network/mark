import { InvalidGradingResultError } from "backend-contracts";
import {
  SourceProcessingError,
  RetryableProcessingError,
} from "../../api/llm/features/grading/errors/source-processing.error";
import { ArgumentsHost, HttpStatus } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { Logger } from "winston";
import { DatabaseCircuitBreakerService } from "../../database/circuit-breaker/database-circuit-breaker.service";
import { AllExceptionsFilter } from "./all-exceptions.filter";

const CLIENT_VERSION = "test";

function makeHost() {
  const response = {
    headersSent: false,
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
    setHeader: jest.fn(),
  };
  const request = {
    method: "GET",
    originalUrl: "/api/v2/assignments/1/attempts",
    body: undefined,
    get: jest.fn().mockReturnValue(undefined),
  };
  const host = {
    switchToHttp: () => ({
      getRequest: () => request,
      getResponse: () => response,
    }),
  } as unknown as ArgumentsHost;
  return { host, response };
}

function makeFilter() {
  const child = { error: jest.fn(), warn: jest.fn() };
  const parentLogger = { child: () => child } as unknown as Logger;
  const circuitBreaker = {
    getStats: jest.fn().mockReturnValue({ state: "CLOSED" }),
  } as unknown as DatabaseCircuitBreakerService;
  return {
    filter: new AllExceptionsFilter(parentLogger, circuitBreaker),
    child,
  };
}

describe("AllExceptionsFilter database connection failures", () => {
  // When the database or its pooler drops every server connection at once,
  // Prisma reports the same event in two shapes: a coded P1017, or an
  // uncoded request error carrying the pooler's own words. Both mean "try
  // again in a moment", and the client only retries a 503.
  it.each([
    [
      "pooler reports a crashed server connection",
      () =>
        new Prisma.PrismaClientUnknownRequestError(
          'Error occurred during query execution:\nConnectorError(ConnectorError { user_facing_error: None, kind: QueryError(Error { kind: Db, cause: Some(DbError { severity: "FATAL", code: SqlState(E08P01), message: "server conn crashed?" }) }) })',
          { clientVersion: CLIENT_VERSION },
        ),
    ],
    [
      "server closed the connection without a code",
      () =>
        new Prisma.PrismaClientUnknownRequestError(
          "Server has closed the connection.",
          { clientVersion: CLIENT_VERSION },
        ),
    ],
    [
      "database is shutting the connection down",
      () =>
        new Prisma.PrismaClientUnknownRequestError(
          "FATAL: terminating connection due to administrator command",
          { clientVersion: CLIENT_VERSION },
        ),
    ],
    [
      "coded P1017",
      () =>
        new Prisma.PrismaClientKnownRequestError(
          "Server has closed the connection.",
          { code: "P1017", clientVersion: CLIENT_VERSION },
        ),
    ],
  ])("answers 503 when the %s", (_label, makeError) => {
    const { filter } = makeFilter();
    const { host, response } = makeHost();

    filter.catch(makeError(), host);

    expect(response.status).toHaveBeenCalledWith(
      HttpStatus.SERVICE_UNAVAILABLE,
    );
  });

  it("tells the client to retry shortly without leaking the database message", () => {
    const { filter } = makeFilter();
    const { host, response } = makeHost();

    filter.catch(
      new Prisma.PrismaClientUnknownRequestError(
        "FATAL: server conn crashed?",
        {
          clientVersion: CLIENT_VERSION,
        },
      ),
      host,
    );

    expect(response.setHeader).toHaveBeenCalledWith("Retry-After", "1");
    const body = response.json.mock.calls[0][0] as {
      statusCode: number;
      message: string;
    };
    expect(body.statusCode).toBe(HttpStatus.SERVICE_UNAVAILABLE);
    expect(body.message).not.toMatch(/conn|FATAL|server/i);
  });

  it("logs the connection failure as a pool error with its context", () => {
    const { filter, child } = makeFilter();
    const { host } = makeHost();

    filter.catch(
      new Prisma.PrismaClientUnknownRequestError(
        "FATAL: server conn crashed?",
        {
          clientVersion: CLIENT_VERSION,
        },
      ),
      host,
    );

    expect(child.error).toHaveBeenCalledWith(
      expect.stringContaining("DB pool/connection error"),
      expect.objectContaining({
        status: HttpStatus.SERVICE_UNAVAILABLE,
        url: "/api/v2/assignments/1/attempts",
      }),
    );
  });

  it("keeps an unrelated uncoded query failure a 500", () => {
    const { filter } = makeFilter();
    const { host, response } = makeHost();

    filter.catch(
      new Prisma.PrismaClientUnknownRequestError(
        'ERROR: invalid byte sequence for encoding "UTF8": 0x00',
        { clientVersion: CLIENT_VERSION },
      ),
      host,
    );

    expect(response.status).toHaveBeenCalledWith(
      HttpStatus.INTERNAL_SERVER_ERROR,
    );
    expect(response.setHeader).not.toHaveBeenCalled();
  });
});

describe("processing failures", () => {
  it.each([
    [new SourceProcessingError("extraction_failed", "file:1"), 422],
    [new RetryableProcessingError("moderation_unavailable"), 503],
  ] as const)(
    "exposes a safe structured processing outcome",
    (error, status) => {
      const { filter } = makeFilter();
      const { host, response } = makeHost();
      filter.catch(error, host);
      expect(response.status).toHaveBeenCalledWith(status);
      expect(response.json).toHaveBeenCalledWith(
        expect.objectContaining({
          message: error.message,
          error: error.name,
          reason: error.reason,
          retryable: error.retryable,
        }),
      );
    },
  );
});

describe("invalid grading result", () => {
  it("returns a safe terminal 502 outcome rather than a learner input error", () => {
    const { filter } = makeFilter();
    const { host, response } = makeHost();
    const error = new InvalidGradingResultError();
    filter.catch(error, host);
    expect(response.status).toHaveBeenCalledWith(502);
    expect(response.json).toHaveBeenCalledWith({
      statusCode: 502,
      message: error.message,
      error: error.name,
      code: error.code,
      retryable: false,
    });
  });
});
