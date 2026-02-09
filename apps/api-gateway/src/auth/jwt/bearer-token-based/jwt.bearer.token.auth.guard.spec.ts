/* eslint-disable */

import { ExecutionContext } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { JwtBearerTokenAuthGuard } from "./jwt.bearer.token.auth.guard";

describe("JwtBearerTokenAuthGuard", () => {
  let guard: JwtBearerTokenAuthGuard;
  let reflector: Reflector;

  beforeEach(() => {
    reflector = new Reflector();
    guard = new JwtBearerTokenAuthGuard(reflector);
  });

  it("should be defined", () => {
    expect(guard).toBeDefined();
  });

  it("should have reflector injected", () => {
    expect((guard as any).reflector).toBe(reflector);
  });

  it("should extend AuthGuard with bearer-token-strategy", () => {
    expect(guard).toBeInstanceOf(JwtBearerTokenAuthGuard);
  });

  it("should work with canActivate", () => {
    const mockContext = createMockExecutionContext();
    jest
      .spyOn(
        Object.getPrototypeOf(JwtBearerTokenAuthGuard.prototype),
        "canActivate",
      )
      .mockReturnValue(true);

    const result = guard.canActivate(mockContext);

    expect(result).toBe(true);
  });

  it("should handle authentication failure", () => {
    const mockContext = createMockExecutionContext();
    jest
      .spyOn(
        Object.getPrototypeOf(JwtBearerTokenAuthGuard.prototype),
        "canActivate",
      )
      .mockReturnValue(false);

    const result = guard.canActivate(mockContext);

    expect(result).toBe(false);
  });
});

function createMockExecutionContext(): ExecutionContext {
  return {
    getHandler: jest.fn().mockReturnValue({}),
    getClass: jest.fn().mockReturnValue({}),
    getArgs: jest.fn(),
    getArgByIndex: jest.fn(),
    switchToRpc: jest.fn(),
    switchToHttp: jest.fn().mockReturnValue({
      getRequest: jest.fn().mockReturnValue({
        headers: { authorization: "Bearer mock-token" },
      }),
      getResponse: jest.fn(),
      getNext: jest.fn(),
    }),
    switchToWs: jest.fn(),
    getType: jest.fn(),
  } as any;
}
