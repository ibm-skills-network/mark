/* eslint-disable */
import { CallHandler, ExecutionContext } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { Test, TestingModule } from "@nestjs/testing";
import { of } from "rxjs";
import {
  DataTransform,
  DataTransformInterceptor,
  TRANSFORM_METADATA_KEY,
} from "../data-transform.interceptor";

describe("DataTransformInterceptor", () => {
  let interceptor: DataTransformInterceptor;
  let reflector: Reflector;
  let executionContext: ExecutionContext;
  let callHandler: CallHandler;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DataTransformInterceptor,
        {
          provide: Reflector,
          useValue: {
            getAllAndOverride: jest.fn(),
          },
        },
      ],
    }).compile();

    interceptor = module.get<DataTransformInterceptor>(
      DataTransformInterceptor,
    );
    reflector = module.get<Reflector>(Reflector);

    // Mock ExecutionContext
    executionContext = {
      switchToHttp: () => ({
        getRequest: () => ({
          body: {},
          query: {},
        }),
      }),
      getHandler: jest.fn(),
      getClass: jest.fn(),
    } as any;

    // Mock CallHandler
    callHandler = {
      handle: () => of({}),
    };
  });

  describe("Request Transformation", () => {
    it("should decode learnerTextResponse and learnerChoices in request body", (done) => {
      const mockRequest = {
        body: {
          submitted: true,
          responsesForQuestions: [
            {
              id: 1,
              learnerTextResponse:
                Buffer.from("<p>Test answer</p>").toString("base64"),
              learnerChoices: [
                Buffer.from("Option A").toString("base64"),
                Buffer.from("Option B").toString("base64"),
              ],
            },
          ],
        },
        query: {},
      };

      executionContext.switchToHttp = () => ({
        getRequest: () => mockRequest as any,
        getResponse: () => ({}) as any,
        getNext: () => ({}) as any,
      });

      // Mock reflector to return undefined (use default config)
      (reflector.getAllAndOverride as jest.Mock).mockReturnValue(undefined);

      const responseData = {
        success: true,
        id: 123,
      };

      callHandler.handle = () => of(responseData);

      interceptor.intercept(executionContext, callHandler).subscribe({
        next: (_result) => {
          // Check that request was transformed
          expect(
            mockRequest.body.responsesForQuestions[0].learnerTextResponse,
          ).toBe("<p>Test answer</p>");
          expect(
            mockRequest.body.responsesForQuestions[0].learnerChoices,
          ).toEqual(["Option A", "Option B"]);
          done();
        },
        error: done,
      });
    });

    it("should handle custom transform options from decorator", (done) => {
      const customOptions = {
        decodeRequest: true,
        encodeResponse: false,
        fields: ["learnerTextResponse", "customField"],
        deep: true,
      };

      const mockRequest = {
        body: {
          learnerTextResponse:
            Buffer.from("<p>Custom test</p>").toString("base64"),
          customField: Buffer.from("Custom value").toString("base64"),
          ignoredField: Buffer.from("Should not decode").toString("base64"),
        },
        query: {},
      };

      executionContext.switchToHttp = () => ({
        getRequest: () => mockRequest as any,
        getResponse: () => ({}) as any,
        getNext: () => ({}) as any,
      });

      (reflector.getAllAndOverride as jest.Mock).mockReturnValue(customOptions);

      callHandler.handle = () => of({ success: true });

      interceptor.intercept(executionContext, callHandler).subscribe({
        next: () => {
          expect(mockRequest.body.learnerTextResponse).toBe(
            "<p>Custom test</p>",
          );
          expect(mockRequest.body.customField).toBe("Custom value");
          expect(mockRequest.body.ignoredField).toBe("Should not decode");
          done();
        },
        error: done,
      });
    });

    it("should transform query parameters when present", (done) => {
      const mockRequest = {
        body: {},
        query: {
          introduction: Buffer.from("Course introduction").toString("base64"),
          filter: "active",
        },
      };

      executionContext.switchToHttp = () => ({
        getRequest: () => mockRequest as any,
        getResponse: () => ({}) as any,
        getNext: () => ({}) as any,
      });

      (reflector.getAllAndOverride as jest.Mock).mockReturnValue(undefined);

      callHandler.handle = () => of({ success: true });

      interceptor.intercept(executionContext, callHandler).subscribe({
        next: () => {
          expect(mockRequest.query.introduction).toBe("Course introduction");
          expect(mockRequest.query.filter).toBe("active");
          done();
        },
        error: done,
      });
    });
  });

  describe("Response Transformation", () => {
    it("should encode learnerTextResponse and learnerChoices in response", (done) => {
      const mockRequest = {
        body: {},
        query: {},
      };

      executionContext.switchToHttp = () => ({
        getRequest: () => mockRequest as any,
        getResponse: () => ({}) as any,
        getNext: () => ({}) as any,
      });

      (reflector.getAllAndOverride as jest.Mock).mockReturnValue(undefined);

      const responseData = {
        assignment: {
          introduction: "Welcome to the course",
        },
        attempts: [
          {
            responsesForQuestions: [
              {
                id: 1,
                learnerTextResponse: "<p>Student response</p>",
                learnerChoices: ["Choice A", "Choice B"],
              },
            ],
          },
        ],
      };

      callHandler.handle = () => of(responseData);

      interceptor.intercept(executionContext, callHandler).subscribe({
        next: (result: any) => {
          // Check that response was encoded
          expect(result.assignment.introduction).not.toBe(
            "Welcome to the course",
          );
          expect(
            Buffer.from(result.assignment.introduction, "base64").toString(
              "utf8",
            ),
          ).toBe("Welcome to the course");

          const encodedResponse =
            result.attempts[0].responsesForQuestions[0].learnerTextResponse;
          expect(encodedResponse).not.toBe("<p>Student response</p>");
          expect(Buffer.from(encodedResponse, "base64").toString("utf8")).toBe(
            "<p>Student response</p>",
          );

          done();
        },
        error: done,
      });
    });

    it("should skip response encoding when encodeResponse is false", (done) => {
      const customOptions = {
        decodeRequest: true,
        encodeResponse: false,
        fields: ["learnerTextResponse"],
        deep: true,
      };

      const mockRequest = {
        body: {},
        query: {},
      };

      executionContext.switchToHttp = () => ({
        getRequest: () => mockRequest as any,
        getResponse: () => ({}) as any,
        getNext: () => ({}) as any,
      });

      (reflector.getAllAndOverride as jest.Mock).mockReturnValue(customOptions);

      const responseData = {
        learnerTextResponse: "<p>Should not be encoded</p>",
      };

      callHandler.handle = () => of(responseData);

      interceptor.intercept(executionContext, callHandler).subscribe({
        next: (result: any) => {
          expect(result.learnerTextResponse).toBe(
            "<p>Should not be encoded</p>",
          );
          done();
        },
        error: done,
      });
    });

    it("should handle null and undefined response data", (done) => {
      const mockRequest = {
        body: {},
        query: {},
      };

      executionContext.switchToHttp = () => ({
        getRequest: () => mockRequest as any,
        getResponse: () => ({}) as any,
        getNext: () => ({}) as any,
      });

      (reflector.getAllAndOverride as jest.Mock).mockReturnValue(undefined);

      callHandler.handle = () => of(null);

      interceptor.intercept(executionContext, callHandler).subscribe({
        next: (_result) => {
          expect(_result).toBeNull();
          done();
        },
        error: done,
      });
    });
  });

  describe("Decorator", () => {
    it("should create metadata with DataTransform decorator", () => {
      const options = {
        fields: ["customField"],
        encodeResponse: false,
      };

      const decorator = DataTransform(options);
      const target = {};
      const propertyKey = "testMethod";
      const descriptor = { value: jest.fn() };

      decorator(target, propertyKey, descriptor);

      const metadata = Reflect.getMetadata(
        TRANSFORM_METADATA_KEY,
        descriptor.value,
      );
      expect(metadata).toEqual(options);
    });
  });

  describe("Edge Cases", () => {
    it("should handle arrays in learnerChoices correctly", (done) => {
      const mockRequest = {
        body: {
          responsesForQuestions: [
            {
              learnerChoices: [
                Buffer.from("Choice 1").toString("base64"),
                Buffer.from("Choice 2 with special chars: @#$%").toString(
                  "base64",
                ),
                Buffer.from("Choice 3").toString("base64"),
              ],
            },
          ],
        },
        query: {},
      };

      executionContext.switchToHttp = () => ({
        getRequest: () => mockRequest as any,
        getResponse: () => ({}) as any,
        getNext: () => ({}) as any,
      });

      (reflector.getAllAndOverride as jest.Mock).mockReturnValue(undefined);

      callHandler.handle = () => of({ success: true });

      interceptor.intercept(executionContext, callHandler).subscribe({
        next: () => {
          expect(
            mockRequest.body.responsesForQuestions[0].learnerChoices,
          ).toEqual([
            "Choice 1",
            "Choice 2 with special chars: @#$%",
            "Choice 3",
          ]);
          done();
        },
        error: done,
      });
    });

    it("should handle malformed base64 gracefully", (done) => {
      const mockRequest = {
        body: {
          learnerTextResponse: "invalid-base64-!@#$%",
          learnerChoices: ["also-invalid-base64"],
        },
        query: {},
      };

      executionContext.switchToHttp = () => ({
        getRequest: () => mockRequest as any,
        getResponse: () => ({}) as any,
        getNext: () => ({}) as any,
      });

      (reflector.getAllAndOverride as jest.Mock).mockReturnValue(undefined);

      callHandler.handle = () => of({ success: true });

      // Should not throw an error
      interceptor.intercept(executionContext, callHandler).subscribe({
        next: () => {
          // Invalid base64 should remain unchanged
          expect(mockRequest.body.learnerTextResponse).toBe(
            "invalid-base64-!@#$%",
          );
          expect(mockRequest.body.learnerChoices).toEqual([
            "also-invalid-base64",
          ]);
          done();
        },
        error: done,
      });
    });

    it("should skip transformation when no options are provided", (done) => {
      const mockRequest = {
        body: { test: "data" },
        query: {},
      };

      executionContext.switchToHttp = () => ({
        getRequest: () => mockRequest as any,
        getResponse: () => ({}) as any,
        getNext: () => ({}) as any,
      });

      // Return null to indicate no transformation should occur
      (reflector.getAllAndOverride as jest.Mock).mockReturnValue(null);

      const responseData = { result: "success" };
      callHandler.handle = () => of(responseData);

      interceptor.intercept(executionContext, callHandler).subscribe({
        next: (_result) => {
          expect(_result).toBe(responseData);
          done();
        },
        error: done,
      });
    });
  });
});
