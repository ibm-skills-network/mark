/* eslint-disable */

import { ExecutionContext } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { UserRole } from "../../interfaces/user.session.interface";
import { MockJwtBearerTokenAuthGuard } from "./mock.jwt.bearer.token.auth.guard";

describe("MockJwtBearerTokenAuthGuard", () => {
  let guard: MockJwtBearerTokenAuthGuard;
  let reflector: Reflector;

  beforeEach(() => {
    reflector = new Reflector();
    guard = new MockJwtBearerTokenAuthGuard(reflector);
  });

  it("should be defined", () => {
    expect(guard).toBeDefined();
  });

  describe("canActivate", () => {
    it("should always return true", () => {
      const mockContext = createMockExecutionContext();

      const result = guard.canActivate(mockContext);

      expect(result).toBe(true);
    });

    it("should inject mock user session into request", () => {
      const mockRequest = {};
      const mockContext = createMockExecutionContext(mockRequest);

      guard.canActivate(mockContext);

      expect((mockRequest as any).user).toBeDefined();
      expect((mockRequest as any).user.userId).toBe("testuser@test.com");
      expect((mockRequest as any).user.role).toBe(UserRole.AUTHOR);
    });

    it("should set all user session properties", () => {
      const mockRequest = {};
      const mockContext = createMockExecutionContext(mockRequest);

      guard.canActivate(mockContext);

      const user = (mockRequest as any).user;
      expect(user.userId).toBe("testuser@test.com");
      expect(user.role).toBe(UserRole.AUTHOR);
      expect(user.groupId).toBe("test-group-id");
      expect(user.assignmentId).toBe(1);
      expect(user.gradingCallbackRequired).toBe(false);
      expect(user.returnUrl).toBe("https://skills.network");
      expect(user.launch_presentation_locale).toBe("en");
    });

    it("should work with different execution contexts", () => {
      const contexts = [
        createMockExecutionContext({}),
        createMockExecutionContext({
          headers: { authorization: "Bearer token" },
        }),
        createMockExecutionContext({ headers: {} }),
      ];

      for (const context of contexts) {
        const result = guard.canActivate(context);
        expect(result).toBe(true);
      }
    });

    it("should always inject same mock user", () => {
      const mockRequest1 = {};
      const mockRequest2 = {};
      const context1 = createMockExecutionContext(mockRequest1);
      const context2 = createMockExecutionContext(mockRequest2);

      guard.canActivate(context1);
      guard.canActivate(context2);

      expect((mockRequest1 as any).user.userId).toBe(
        (mockRequest2 as any).user.userId,
      );
    });

    it("should set admin property to true", () => {
      const mockRequest = {};
      const mockContext = createMockExecutionContext(mockRequest);

      guard.canActivate(mockContext);

      expect((mockRequest as any).user.admin).toBe(true);
    });
  });
});

function createMockExecutionContext(request: any = {}): ExecutionContext {
  return {
    getHandler: jest.fn(),
    getClass: jest.fn(),
    getArgs: jest.fn(),
    getArgByIndex: jest.fn(),
    switchToRpc: jest.fn(),
    switchToHttp: jest.fn().mockReturnValue({
      getRequest: jest.fn().mockReturnValue(request),
      getResponse: jest.fn(),
      getNext: jest.fn(),
    }),
    switchToWs: jest.fn(),
    getType: jest.fn(),
  } as any;
}
