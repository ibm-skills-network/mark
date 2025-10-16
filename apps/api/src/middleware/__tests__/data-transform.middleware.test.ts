/* eslint-disable */
import { Test, TestingModule } from "@nestjs/testing";
import { NextFunction, Request, Response } from "express";
import { DataTransformMiddleware } from "../data-transform.middleware";

describe("DataTransformMiddleware", () => {
  let middleware: DataTransformMiddleware;
  let mockRequest: Partial<Request>;
  let mockResponse: Partial<Response>;
  let mockNext: NextFunction;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [DataTransformMiddleware],
    }).compile();

    middleware = module.get<DataTransformMiddleware>(DataTransformMiddleware);

    mockRequest = {
      path: "/api/v2/assignments/1/attempts/1",
      body: {},
      query: {},
    };

    mockResponse = {
      json: jest.fn(),
      locals: {},
    };

    mockNext = jest.fn();
  });

  describe("Request Transformation (Decoding)", () => {
    it("should decode learnerTextResponse in assignment submission", () => {
      mockRequest.body = {
        submitted: true,
        responsesForQuestions: [
          {
            id: 1,
            learnerTextResponse: "PHA+dGVzdDwvcD4=",
            learnerChoices: ["VXNlIHRoZSBASW5qZWN0YWJsZSgpIGRlY29yYXRvcg=="], // pragma: allowlist secret
          },
        ],
      };

      middleware.use(
        mockRequest as Request,
        mockResponse as Response,
        mockNext,
      );

      expect(mockRequest.body).toEqual({
        submitted: true,
        responsesForQuestions: [
          {
            id: 1,
            learnerTextResponse: "<p>test</p>",
            learnerChoices: ["Use the @Injectable() decorator"],
          },
        ],
      });

      expect(mockNext).toHaveBeenCalled();
    });

    it("should decode multiple learner responses with various content", () => {
      // Base64 encoding test data
      const htmlContent = Buffer.from(
        "<div><strong>Bold</strong> text</div>",
      ).toString("base64");
      const choice1 = Buffer.from("Apply the @Inject() decorator").toString(
        "base64",
      );
      const choice2 = Buffer.from("Use dependency injection").toString(
        "base64",
      );

      mockRequest.body = {
        submitted: true,
        responsesForQuestions: [
          {
            id: 1,
            learnerTextResponse: htmlContent,
            learnerChoices: [choice1, choice2],
          },
          {
            id: 2,
            learnerTextResponse: Buffer.from("<p>Another answer</p>").toString(
              "base64",
            ),
            learnerChoices: [Buffer.from("Simple choice").toString("base64")],
          },
        ],
      };

      middleware.use(
        mockRequest as Request,
        mockResponse as Response,
        mockNext,
      );

      expect(mockRequest.body).toEqual({
        submitted: true,
        responsesForQuestions: [
          {
            id: 1,
            learnerTextResponse: "<div><strong>Bold</strong> text</div>",
            learnerChoices: [
              "Apply the @Inject() decorator",
              "Use dependency injection",
            ],
          },
          {
            id: 2,
            learnerTextResponse: "<p>Another answer</p>",
            learnerChoices: ["Simple choice"],
          },
        ],
      });
    });

    it("should handle empty and null values gracefully", () => {
      mockRequest.body = {
        submitted: true,
        responsesForQuestions: [
          {
            id: 1,
            learnerTextResponse: "",
            learnerChoices: [],
          },
          {
            id: 2,
            learnerTextResponse: null,
            learnerChoices: null,
          },
        ],
      };

      middleware.use(
        mockRequest as Request,
        mockResponse as Response,
        mockNext,
      );

      expect(mockRequest.body).toEqual({
        submitted: true,
        responsesForQuestions: [
          {
            id: 1,
            learnerTextResponse: "",
            learnerChoices: [],
          },
          {
            id: 2,
            learnerTextResponse: null,
            learnerChoices: null,
          },
        ],
      });

      expect(mockNext).toHaveBeenCalled();
    });

    it("should not transform excluded routes", () => {
      Object.defineProperty(mockRequest, "path", {
        value: "/health",
        writable: true,
      });
      mockRequest.body = {
        learnerTextResponse: "PHA+dGVzdDwvcD4=",
      };

      middleware.use(
        mockRequest as Request,
        mockResponse as Response,
        mockNext,
      );

      // Should not decode the health route
      expect(mockRequest.body.learnerTextResponse).toBe("PHA+dGVzdDwvcD4=");
      expect(mockNext).toHaveBeenCalled();
    });

    it("should handle malformed base64 gracefully", () => {
      mockRequest.body = {
        responsesForQuestions: [
          {
            id: 1,
            learnerTextResponse: "not-valid-base64!@#",
            learnerChoices: ["also-not-valid-base64!"],
          },
        ],
      };

      expect(() => {
        middleware.use(
          mockRequest as Request,
          mockResponse as Response,
          mockNext,
        );
      }).not.toThrow();

      expect(mockNext).toHaveBeenCalled();
    });

    it("should transform query parameters when present", () => {
      const encodedIntroduction = Buffer.from("Welcome to the course").toString(
        "base64",
      );

      mockRequest.query = {
        introduction: encodedIntroduction,
        page: "1",
      };

      middleware.use(
        mockRequest as Request,
        mockResponse as Response,
        mockNext,
      );

      expect(mockRequest.query).toEqual({
        introduction: "Welcome to the course",
        page: "1",
      });
    });
  });

  describe("Response Transformation (Encoding)", () => {
    it("should set up response interceptor", () => {
      middleware.use(
        mockRequest as Request,
        mockResponse as Response,
        mockNext,
      );

      // Check that response.json was replaced
      expect(mockResponse.json).toBeDefined();
      expect(mockResponse.locals?.middleware?.transformData).toBeDefined();
    });

    it("should encode response data through interceptor", () => {
      middleware.use(
        mockRequest as Request,
        mockResponse as Response,
        mockNext,
      );

      const responseData = {
        introduction: "Welcome to the course",
        responsesForQuestions: [
          {
            id: 1,
            learnerTextResponse: "<p>Student answer</p>",
            learnerChoices: ["Choice A"],
          },
        ],
      };

      // Mock the original json function
      const originalJson = jest.fn();
      (mockResponse as any).json = originalJson;

      // Get the middleware instance and call transformData
      const transformData = mockResponse.locals?.middleware?.transformData;
      expect(transformData).toBeDefined();

      if (transformData) {
        const encodedData = transformData(responseData, "encode");

        // The encoded data should have base64 encoded fields
        expect(encodedData.introduction).not.toBe("Welcome to the course");
        expect(
          encodedData.responsesForQuestions[0].learnerTextResponse,
        ).not.toBe("<p>Student answer</p>");
        expect(
          Buffer.from(encodedData.introduction, "base64").toString("utf8"),
        ).toBe("Welcome to the course");
      }
    });
  });

  describe("Edge Cases", () => {
    it("should handle empty request body", () => {
      mockRequest.body = undefined;

      expect(() => {
        middleware.use(
          mockRequest as Request,
          mockResponse as Response,
          mockNext,
        );
      }).not.toThrow();

      expect(mockNext).toHaveBeenCalled();
    });

    it("should handle deeply nested objects", () => {
      const nestedData = {
        assignment: {
          questions: [
            {
              variants: [
                {
                  content: Buffer.from("<p>Question content</p>").toString(
                    "base64",
                  ),
                  scoring: {
                    rubrics: [
                      {
                        rubricQuestion:
                          Buffer.from("Rubric question").toString("base64"),
                      },
                    ],
                  },
                },
              ],
            },
          ],
        },
        responsesForQuestions: [
          {
            learnerTextResponse:
              Buffer.from("<p>Answer</p>").toString("base64"),
          },
        ],
      };

      mockRequest.body = nestedData;

      middleware.use(
        mockRequest as Request,
        mockResponse as Response,
        mockNext,
      );

      // Check that nested fields were decoded
      expect(mockRequest.body.assignment.questions[0].variants[0].content).toBe(
        "<p>Question content</p>",
      );
      expect(
        mockRequest.body.responsesForQuestions[0].learnerTextResponse,
      ).toBe("<p>Answer</p>");
    });

    it("should handle array of primitive values in learnerChoices", () => {
      mockRequest.body = {
        responsesForQuestions: [
          {
            id: 1,
            learnerChoices: [
              Buffer.from("First choice").toString("base64"),
              Buffer.from("Second choice").toString("base64"),
              Buffer.from("Third choice with special chars: @#$").toString(
                "base64",
              ),
            ],
          },
        ],
      };

      middleware.use(
        mockRequest as Request,
        mockResponse as Response,
        mockNext,
      );

      expect(mockRequest.body.responsesForQuestions[0].learnerChoices).toEqual([
        "First choice",
        "Second choice",
        "Third choice with special chars: @#$",
      ]);
    });
  });
});
