import { EventEmitter } from "node:events";
import { NextFunction, Request, Response } from "express";
import { Logger } from "winston";
import { LoggerMiddleware } from "./logger.middleware";

type MockLogger = Pick<Logger, "debug" | "info" | "warn" | "error">;

function setWritableEnded(target: object, value: boolean): void {
  Object.defineProperty(target, "writableEnded", { value, configurable: true });
}

const OAUTH_REFERER =
  "https://mark.example/learner/3601/questions?code=abc&state=signed-state-value&iss=https%3A%2F%2Fgithub.com%2Flogin%2Foauth";

describe("LoggerMiddleware", () => {
  let middleware: LoggerMiddleware;
  let logger: MockLogger;
  let request: Partial<Request>;
  let response: Partial<Response> & EventEmitter;
  let next: NextFunction;

  const allLoggedPayloads = (): Record<string, unknown>[] =>
    [logger.debug, logger.info, logger.warn, logger.error].flatMap((fn) =>
      (fn as jest.Mock).mock.calls.map((call) => call[1]),
    );

  const allLoggedMessages = (): string[] =>
    [logger.debug, logger.info, logger.warn, logger.error].flatMap((fn) =>
      (fn as jest.Mock).mock.calls.map((call) => String(call[0])),
    );

  const headers = (values: Record<string, string>) => {
    (request.get as jest.Mock).mockImplementation(
      (header: string) => values[header.toLowerCase()] ?? null,
    );
  };

  beforeEach(() => {
    logger = {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    };

    middleware = new LoggerMiddleware(logger as Logger);

    request = {
      method: "GET",
      originalUrl: "/api/v2/user-session",
      get: jest.fn().mockReturnValue(null) as unknown as Request["get"],
    };

    response = new EventEmitter() as Partial<Response> & EventEmitter;
    response.statusCode = 200;
    response.get = jest
      .fn()
      .mockReturnValue(null) as unknown as Response["get"];
    setWritableEnded(response, true);

    next = jest.fn();
  });

  it("calls next immediately", () => {
    middleware.use(request as Request, response as Response, next);

    expect(next).toHaveBeenCalledTimes(1);
  });

  it("logs the referer without the OAuth code or state on the request line", () => {
    headers({ referer: OAUTH_REFERER });

    middleware.use(request as Request, response as Response, next);

    expect(logger.debug).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        referer: "https://mark.example/learner/3601/questions",
      }),
    );
  });

  it("logs the referer without the OAuth code or state on the response line", (done) => {
    headers({ referer: OAUTH_REFERER });

    middleware.use(request as Request, response as Response, next);
    response.emit("finish");

    setTimeout(() => {
      expect(logger.info).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          referer: "https://mark.example/learner/3601/questions",
        }),
      );
      done();
    }, 10);
  });

  it("logs the referer without the OAuth code or state when the client disconnects", (done) => {
    headers({ referer: OAUTH_REFERER });
    setWritableEnded(response, false);

    middleware.use(request as Request, response as Response, next);
    response.emit("close");

    setTimeout(() => {
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining("client_disconnected"),
        expect.objectContaining({
          referer: "https://mark.example/learner/3601/questions",
        }),
      );
      done();
    }, 10);
  });

  it("never writes the OAuth code or state anywhere in the log record", (done) => {
    headers({ referer: OAUTH_REFERER });
    setWritableEnded(response, false);

    middleware.use(request as Request, response as Response, next);
    response.emit("finish");
    response.emit("close");

    setTimeout(() => {
      const serialized = JSON.stringify([
        allLoggedMessages(),
        allLoggedPayloads(),
      ]);

      expect(serialized).not.toContain("code=abc");
      expect(serialized).not.toContain("signed-state-value");
      expect(serialized).toContain(
        "https://mark.example/learner/3601/questions",
      );
      done();
    }, 10);
  });

  it("uses an empty referer when the header is absent", (done) => {
    middleware.use(request as Request, response as Response, next);
    response.emit("finish");

    setTimeout(() => {
      expect(logger.info).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ referer: "", user_agent: "" }),
      );
      done();
    }, 10);
  });

  it("keeps ordinary query strings on the request URL", (done) => {
    request.originalUrl = "/api/v2/assignments/3601/attempts/1?lang=en";

    middleware.use(request as Request, response as Response, next);
    response.emit("finish");

    setTimeout(() => {
      expect(logger.info).toHaveBeenCalledWith(
        expect.stringContaining(
          "GET /api/v2/assignments/3601/attempts/1?lang=en 200",
        ),
        expect.objectContaining({
          url: "/api/v2/assignments/3601/attempts/1?lang=en",
        }),
      );
      done();
    }, 10);
  });

  it("redacts a deny-listed query parameter on the request URL", (done) => {
    request.originalUrl = "/api/v2/github/oauth-callback?code=abc&lang=en";

    middleware.use(request as Request, response as Response, next);
    response.emit("finish");

    setTimeout(() => {
      expect(logger.info).toHaveBeenCalledWith(
        expect.stringContaining(
          "/api/v2/github/oauth-callback?code=[redacted]&lang=en",
        ),
        expect.objectContaining({
          url: "/api/v2/github/oauth-callback?code=[redacted]&lang=en",
        }),
      );
      expect(JSON.stringify(allLoggedMessages())).not.toContain("code=abc");
      done();
    }, 10);
  });

  it("logs 4xx as a warning and 5xx as an error", (done) => {
    response.statusCode = 503;

    middleware.use(request as Request, response as Response, next);
    response.emit("finish");

    setTimeout(() => {
      expect(logger.error).toHaveBeenCalledWith(
        expect.stringContaining("GET /api/v2/user-session 503"),
        expect.any(Object),
      );
      done();
    }, 10);
  });
});
