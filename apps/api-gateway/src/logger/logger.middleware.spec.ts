/* eslint-disable */

import { EventEmitter } from "node:events";
import { NextFunction, Request, Response } from "express";
import { Logger } from "winston";
import { LoggerMiddleware } from "./logger.middleware";

describe("LoggerMiddleware", () => {
  let middleware: LoggerMiddleware;
  let mockLogger: Logger;
  let mockRequest: Partial<Request>;
  let mockResponse: Partial<Response> & EventEmitter;
  let mockNext: NextFunction;

  beforeEach(() => {
    mockLogger = {
      info: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
      debug: jest.fn(),
    } as any;

    middleware = new LoggerMiddleware(mockLogger);

    mockRequest = {
      method: "GET",
      originalUrl: "/api/test",
      get: jest.fn(),
    };

    mockResponse = new EventEmitter() as any;
    mockResponse.statusCode = 200;
    mockResponse.get = jest.fn();

    mockNext = jest.fn();
  });

  describe("use", () => {
    it("should call next function immediately", () => {
      middleware.use(
        mockRequest as Request,
        mockResponse as Response,
        mockNext,
      );

      expect(mockNext).toHaveBeenCalledTimes(1);
    });

    it("should log request details when response finishes", (done) => {
      (mockRequest.get as jest.Mock).mockImplementation((header: string) => {
        if (header === "true-client-ip") return "192.168.1.1";
        if (header === "x-transaction-id") return "txn-123";
        if (header === "x-request-id") return "req-456";
        if (header === "user-agent") return "Mozilla/5.0";
        return null;
      });

      (mockResponse.get as jest.Mock).mockImplementation((header: string) => {
        if (header === "content-length") return "1234";
        return null;
      });

      middleware.use(
        mockRequest as Request,
        mockResponse as Response,
        mockNext,
      );

      mockResponse.emit("finish");

      setTimeout(() => {
        expect(mockLogger.info).toHaveBeenCalledWith(
          expect.stringContaining("GET /api/test 200"),
          expect.objectContaining({
            client_ip: "192.168.1.1",
            transaction_id: "txn-123",
            request_id: "req-456",
            method: "GET",
            url: "/api/test",
            status_code: 200,
            content_length: "1234",
            user_agent: "Mozilla/5.0",
          }),
        );
        done();
      }, 10);
    });

    it("should handle POST requests", (done) => {
      mockRequest.method = "POST";
      mockRequest.originalUrl = "/api/create";
      mockResponse.statusCode = 201;

      (mockRequest.get as jest.Mock).mockReturnValue(null);
      (mockResponse.get as jest.Mock).mockReturnValue(null);

      middleware.use(
        mockRequest as Request,
        mockResponse as Response,
        mockNext,
      );

      mockResponse.emit("finish");

      setTimeout(() => {
        expect(mockLogger.info).toHaveBeenCalledWith(
          expect.stringContaining("POST /api/create 201"),
          expect.any(Object),
        );
        done();
      }, 10);
    });

    it("should handle PUT requests", (done) => {
      mockRequest.method = "PUT";
      mockRequest.originalUrl = "/api/update/123";
      mockResponse.statusCode = 200;

      (mockRequest.get as jest.Mock).mockReturnValue(null);
      (mockResponse.get as jest.Mock).mockReturnValue(null);

      middleware.use(
        mockRequest as Request,
        mockResponse as Response,
        mockNext,
      );

      mockResponse.emit("finish");

      setTimeout(() => {
        expect(mockLogger.info).toHaveBeenCalledWith(
          expect.stringContaining("PUT /api/update/123 200"),
          expect.any(Object),
        );
        done();
      }, 10);
    });

    it("should handle DELETE requests", (done) => {
      mockRequest.method = "DELETE";
      mockRequest.originalUrl = "/api/delete/123";
      mockResponse.statusCode = 204;

      (mockRequest.get as jest.Mock).mockReturnValue(null);
      (mockResponse.get as jest.Mock).mockReturnValue(null);

      middleware.use(
        mockRequest as Request,
        mockResponse as Response,
        mockNext,
      );

      mockResponse.emit("finish");

      setTimeout(() => {
        expect(mockLogger.info).toHaveBeenCalledWith(
          expect.stringContaining("DELETE /api/delete/123 204"),
          expect.any(Object),
        );
        done();
      }, 10);
    });

    it("should handle 400 error responses", (done) => {
      mockResponse.statusCode = 400;

      (mockRequest.get as jest.Mock).mockReturnValue(null);
      (mockResponse.get as jest.Mock).mockReturnValue(null);

      middleware.use(
        mockRequest as Request,
        mockResponse as Response,
        mockNext,
      );

      mockResponse.emit("finish");

      setTimeout(() => {
        expect(mockLogger.info).toHaveBeenCalledWith(
          expect.stringContaining("GET /api/test 400"),
          expect.any(Object),
        );
        done();
      }, 10);
    });

    it("should handle 404 error responses", (done) => {
      mockResponse.statusCode = 404;

      (mockRequest.get as jest.Mock).mockReturnValue(null);
      (mockResponse.get as jest.Mock).mockReturnValue(null);

      middleware.use(
        mockRequest as Request,
        mockResponse as Response,
        mockNext,
      );

      mockResponse.emit("finish");

      setTimeout(() => {
        expect(mockLogger.info).toHaveBeenCalledWith(
          expect.stringContaining("GET /api/test 404"),
          expect.any(Object),
        );
        done();
      }, 10);
    });

    it("should handle 500 error responses", (done) => {
      mockResponse.statusCode = 500;

      (mockRequest.get as jest.Mock).mockReturnValue(null);
      (mockResponse.get as jest.Mock).mockReturnValue(null);

      middleware.use(
        mockRequest as Request,
        mockResponse as Response,
        mockNext,
      );

      mockResponse.emit("finish");

      setTimeout(() => {
        expect(mockLogger.info).toHaveBeenCalledWith(
          expect.stringContaining("GET /api/test 500"),
          expect.any(Object),
        );
        done();
      }, 10);
    });

    it("should use empty string for missing user-agent", (done) => {
      (mockRequest.get as jest.Mock).mockImplementation((header: string) => {
        if (header === "user-agent") return null;
        return null;
      });

      (mockResponse.get as jest.Mock).mockReturnValue(null);

      middleware.use(
        mockRequest as Request,
        mockResponse as Response,
        mockNext,
      );

      mockResponse.emit("finish");

      setTimeout(() => {
        expect(mockLogger.info).toHaveBeenCalledWith(
          expect.any(String),
          expect.objectContaining({
            user_agent: "",
          }),
        );
        done();
      }, 10);
    });

    it("should prefer akamai-grn over x-request-id", (done) => {
      (mockRequest.get as jest.Mock).mockImplementation((header: string) => {
        if (header === "akamai-grn") return "akamai-123";
        if (header === "x-request-id") return "req-456";
        return null;
      });

      (mockResponse.get as jest.Mock).mockReturnValue(null);

      middleware.use(
        mockRequest as Request,
        mockResponse as Response,
        mockNext,
      );

      mockResponse.emit("finish");

      setTimeout(() => {
        expect(mockLogger.info).toHaveBeenCalledWith(
          expect.any(String),
          expect.objectContaining({
            request_id: "akamai-123",
          }),
        );
        done();
      }, 10);
    });

    it("should fall back to x-request-id when akamai-grn is missing", (done) => {
      (mockRequest.get as jest.Mock).mockImplementation((header: string) => {
        if (header === "akamai-grn") return null;
        if (header === "x-request-id") return "req-456";
        return null;
      });

      (mockResponse.get as jest.Mock).mockReturnValue(null);

      middleware.use(
        mockRequest as Request,
        mockResponse as Response,
        mockNext,
      );

      mockResponse.emit("finish");

      setTimeout(() => {
        expect(mockLogger.info).toHaveBeenCalledWith(
          expect.any(String),
          expect.objectContaining({
            request_id: "req-456",
          }),
        );
        done();
      }, 10);
    });

    it("should calculate response time correctly", (done) => {
      (mockRequest.get as jest.Mock).mockReturnValue(null);
      (mockResponse.get as jest.Mock).mockReturnValue(null);

      middleware.use(
        mockRequest as Request,
        mockResponse as Response,
        mockNext,
      );

      // Wait a bit to ensure some time passes
      setTimeout(() => {
        mockResponse.emit("finish");

        setTimeout(() => {
          expect(mockLogger.info).toHaveBeenCalled();
          const logCall = (mockLogger.info as jest.Mock).mock.calls[0][0];
          expect(logCall).toMatch(/\d+\.\d{2}ms$/);
          done();
        }, 10);
      }, 10);
    });

    it("should handle requests with query parameters", (done) => {
      mockRequest.originalUrl = "/api/test?page=1&limit=10";

      (mockRequest.get as jest.Mock).mockReturnValue(null);
      (mockResponse.get as jest.Mock).mockReturnValue(null);

      middleware.use(
        mockRequest as Request,
        mockResponse as Response,
        mockNext,
      );

      mockResponse.emit("finish");

      setTimeout(() => {
        expect(mockLogger.info).toHaveBeenCalledWith(
          expect.stringContaining("GET /api/test?page=1&limit=10 200"),
          expect.any(Object),
        );
        done();
      }, 10);
    });

    it("should handle requests with all headers present", (done) => {
      (mockRequest.get as jest.Mock).mockImplementation((header: string) => {
        const headers: Record<string, string> = {
          "true-client-ip": "10.0.0.1",
          "x-transaction-id": "transaction-abc",
          "akamai-grn": "akamai-xyz",
          "x-request-id": "request-123",
          "user-agent": "Test Agent/1.0",
        };
        return headers[header] || null;
      });

      (mockResponse.get as jest.Mock).mockImplementation((header: string) => {
        if (header === "content-length") return "5678";
        return null;
      });

      middleware.use(
        mockRequest as Request,
        mockResponse as Response,
        mockNext,
      );

      mockResponse.emit("finish");

      setTimeout(() => {
        expect(mockLogger.info).toHaveBeenCalledWith(
          expect.stringContaining("GET /api/test 200"),
          {
            client_ip: "10.0.0.1",
            transaction_id: "transaction-abc",
            request_id: "akamai-xyz",
            method: "GET",
            url: "/api/test",
            status_code: 200,
            content_length: "5678",
            user_agent: "Test Agent/1.0",
          },
        );
        done();
      }, 10);
    });

    it("should handle PATCH requests", (done) => {
      mockRequest.method = "PATCH";
      mockRequest.originalUrl = "/api/patch/123";
      mockResponse.statusCode = 200;

      (mockRequest.get as jest.Mock).mockReturnValue(null);
      (mockResponse.get as jest.Mock).mockReturnValue(null);

      middleware.use(
        mockRequest as Request,
        mockResponse as Response,
        mockNext,
      );

      mockResponse.emit("finish");

      setTimeout(() => {
        expect(mockLogger.info).toHaveBeenCalledWith(
          expect.stringContaining("PATCH /api/patch/123 200"),
          expect.any(Object),
        );
        done();
      }, 10);
    });

    it("should handle HEAD requests", (done) => {
      mockRequest.method = "HEAD";
      mockRequest.originalUrl = "/api/test";
      mockResponse.statusCode = 200;

      (mockRequest.get as jest.Mock).mockReturnValue(null);
      (mockResponse.get as jest.Mock).mockReturnValue(null);

      middleware.use(
        mockRequest as Request,
        mockResponse as Response,
        mockNext,
      );

      mockResponse.emit("finish");

      setTimeout(() => {
        expect(mockLogger.info).toHaveBeenCalledWith(
          expect.stringContaining("HEAD /api/test 200"),
          expect.any(Object),
        );
        done();
      }, 10);
    });

    it("should handle OPTIONS requests", (done) => {
      mockRequest.method = "OPTIONS";
      mockRequest.originalUrl = "/api/test";
      mockResponse.statusCode = 204;

      (mockRequest.get as jest.Mock).mockReturnValue(null);
      (mockResponse.get as jest.Mock).mockReturnValue(null);

      middleware.use(
        mockRequest as Request,
        mockResponse as Response,
        mockNext,
      );

      mockResponse.emit("finish");

      setTimeout(() => {
        expect(mockLogger.info).toHaveBeenCalledWith(
          expect.stringContaining("OPTIONS /api/test 204"),
          expect.any(Object),
        );
        done();
      }, 10);
    });

    it("should handle 503 service unavailable responses", (done) => {
      mockResponse.statusCode = 503;

      (mockRequest.get as jest.Mock).mockReturnValue(null);
      (mockResponse.get as jest.Mock).mockReturnValue(null);

      middleware.use(
        mockRequest as Request,
        mockResponse as Response,
        mockNext,
      );

      mockResponse.emit("finish");

      setTimeout(() => {
        expect(mockLogger.info).toHaveBeenCalledWith(
          expect.stringContaining("GET /api/test 503"),
          expect.any(Object),
        );
        done();
      }, 10);
    });

    it("should handle undefined request headers gracefully", (done) => {
      (mockRequest.get as jest.Mock).mockReturnValue(
        undefined as unknown as string,
      );
      (mockResponse.get as jest.Mock).mockReturnValue(
        undefined as unknown as string,
      );

      middleware.use(
        mockRequest as Request,
        mockResponse as Response,
        mockNext,
      );

      mockResponse.emit("finish");

      setTimeout(() => {
        expect(mockLogger.info).toHaveBeenCalled();
        const requestDetails = (mockLogger.info as jest.Mock).mock.calls[0][1];
        expect(requestDetails.client_ip).toBeUndefined();
        expect(requestDetails.transaction_id).toBeUndefined();
        expect(requestDetails.user_agent).toBe("");
        done();
      }, 10);
    });
  });
});
