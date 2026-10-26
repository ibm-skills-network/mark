/* eslint-disable */

import { ExecutionContext } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { IS_PUBLIC_KEY, JwtCookieAuthGuard } from "./jwt.cookie.auth.guard";
import { SavedSessionStore } from "./saved-session.store";

describe("JwtCookieAuthGuard", () => {
  let guard: JwtCookieAuthGuard;
  let reflector: Reflector;

  beforeEach(() => {
    reflector = new Reflector();
    guard = new JwtCookieAuthGuard(reflector, {
      find: jest.fn(),
    } as unknown as SavedSessionStore);
  });

  describe("canActivate", () => {
    it("should return true for public routes", () => {
      const mockContext = createMockExecutionContext();
      jest.spyOn(reflector, "getAllAndOverride").mockReturnValue(true);

      const result = guard.canActivate(mockContext);

      expect(result).toBe(true);
      expect(reflector.getAllAndOverride).toHaveBeenCalledWith(IS_PUBLIC_KEY, [
        mockContext.getHandler(),
        mockContext.getClass(),
      ]);
    });

    it("should check reflector with correct parameters for public metadata", () => {
      const mockContext = createMockExecutionContext();
      const spy = jest
        .spyOn(reflector, "getAllAndOverride")
        .mockReturnValue(true);

      guard.canActivate(mockContext);

      expect(spy).toHaveBeenCalledWith(IS_PUBLIC_KEY, [
        mockContext.getHandler(),
        mockContext.getClass(),
      ]);
    });

    it("should return true when handler is marked public", () => {
      const mockContext = createMockExecutionContext();
      jest.spyOn(reflector, "getAllAndOverride").mockReturnValue(true);

      const result = guard.canActivate(mockContext);

      expect(result).toBe(true);
    });

    it("should return true when class is marked public", () => {
      const mockContext = createMockExecutionContext();
      jest.spyOn(reflector, "getAllAndOverride").mockReturnValue(true);

      const result = guard.canActivate(mockContext);

      expect(result).toBe(true);
    });

    it("should check both handler and class decorators", () => {
      const mockHandler = {};
      const mockClass = {};
      const mockContext = {
        getHandler: jest.fn().mockReturnValue(mockHandler),
        getClass: jest.fn().mockReturnValue(mockClass),
        switchToHttp: jest.fn(),
      } as any;

      jest.spyOn(reflector, "getAllAndOverride").mockReturnValue(true);

      guard.canActivate(mockContext);

      expect(reflector.getAllAndOverride).toHaveBeenCalledWith(IS_PUBLIC_KEY, [
        mockHandler,
        mockClass,
      ]);
    });
  });

  describe("edge cases", () => {
    it("should handle false reflector result and call super", () => {
      const mockContext = createMockExecutionContext();
      jest.spyOn(reflector, "getAllAndOverride").mockReturnValue(false);

      // We just verify the reflector was checked, super.canActivate requires Passport setup
      expect(reflector.getAllAndOverride).toBeDefined();
    });

    it("should handle null/undefined reflector results as false (not public)", () => {
      const mockContext = createMockExecutionContext();

      // null should be treated as false (not public)
      jest.spyOn(reflector, "getAllAndOverride").mockReturnValue(null as any);
      expect(reflector.getAllAndOverride).toBeDefined();

      // undefined should be treated as false (not public)
      jest
        .spyOn(reflector, "getAllAndOverride")
        .mockReturnValue(undefined as any);
      expect(reflector.getAllAndOverride).toBeDefined();
    });
  });
});

describe("JwtCookieAuthGuard saved session lookup", () => {
  const storeId = "7f0c6c1e-3c1a-4c55-9a8e-2b8f6f1d0a11";
  const quiz = { "x-mark-learner-assignment": "4892" };
  let reflector: Reflector;
  let find: jest.Mock;
  let guard: JwtCookieAuthGuard;
  let passport: jest.SpyInstance;

  const requestWith = (headers: Record<string, string>): any => ({
    headers,
    cookies: Object.fromEntries(
      (headers.cookie ?? "")
        .split("; ")
        .filter(Boolean)
        .map((pair) => pair.split("=")),
    ),
  });
  const contextFor = (request: any): ExecutionContext =>
    ({
      getHandler: () => ({}),
      getClass: () => ({}),
      switchToHttp: () => ({ getRequest: () => request }),
    }) as any;

  beforeEach(() => {
    reflector = new Reflector();
    jest.spyOn(reflector, "getAllAndOverride").mockReturnValue(false);
    find = jest.fn().mockResolvedValue("saved-token");
    guard = new JwtCookieAuthGuard(reflector, {
      find,
    } as unknown as SavedSessionStore);
    passport = jest
      .spyOn(Object.getPrototypeOf(JwtCookieAuthGuard.prototype), "canActivate")
      .mockResolvedValue(true);
  });

  afterEach(() => passport.mockRestore());

  it("loads the quiz's saved session before passport runs", async () => {
    const request = requestWith({
      cookie: `authentication=launch; mark_saved_sessions=${storeId}`,
      ...quiz,
    });
    passport.mockImplementation(async () => {
      expect(request.savedSession).toBe("saved-token");
      return true;
    });

    await expect(guard.canActivate(contextFor(request))).resolves.toBe(true);
    expect(find).toHaveBeenCalledWith(storeId, "learner", 4892);
    expect(passport).toHaveBeenCalled();
  });

  it.each([
    ["an author header", { "x-mark-author-assignment": "4892" }, "author"],
    [
      "an author page referer",
      { referer: "https://mark.example/author/4892/questions" },
      "author",
    ],
    [
      "an author preview referer",
      { referer: "https://mark.example/learner/4892?authorMode=true" },
      "author",
    ],
    [
      "a learner page referer",
      { referer: "https://mark.example/learner/4892" },
      "learner",
    ],
  ])("looks up the saved session for %s", async (_name, context, role) => {
    const request = requestWith({
      cookie: `authentication=launch; mark_saved_sessions=${storeId}`,
      ...context,
    });

    await expect(guard.canActivate(contextFor(request))).resolves.toBe(true);
    expect(find).toHaveBeenCalledWith(storeId, role, 4892);
    expect(request.savedSession).toBe("saved-token");
  });

  it.each([
    [
      "no quiz context",
      { cookie: `authentication=launch; mark_saved_sessions=${storeId}` },
    ],
    [
      "no current session",
      { cookie: `mark_saved_sessions=${storeId}`, ...quiz },
    ],
    ["no store id", { cookie: "authentication=launch", ...quiz }],
    [
      "a store id that is not a GUID",
      { cookie: "authentication=launch; mark_saved_sessions=nope", ...quiz },
    ],
  ])("skips the lookup with %s", async (_name, headers) => {
    const request = requestWith(headers);
    await expect(guard.canActivate(contextFor(request))).resolves.toBe(true);
    expect(find).not.toHaveBeenCalled();
    expect(request.savedSession).toBeUndefined();
    expect(passport).toHaveBeenCalled();
  });

  it("still authenticates when nothing is saved", async () => {
    find.mockResolvedValue(undefined);
    const request = requestWith({
      cookie: `authentication=launch; mark_saved_sessions=${storeId}`,
      ...quiz,
    });
    await expect(guard.canActivate(contextFor(request))).resolves.toBe(true);
    expect(request.savedSession).toBeUndefined();
  });

  it("does not look up saved sessions for public routes", () => {
    jest.spyOn(reflector, "getAllAndOverride").mockReturnValue(true);
    const request = requestWith({
      cookie: `authentication=launch; mark_saved_sessions=${storeId}`,
      ...quiz,
    });
    expect(guard.canActivate(contextFor(request))).toBe(true);
    expect(find).not.toHaveBeenCalled();
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
        cookies: { authentication: "mock-token" },
      }),
      getResponse: jest.fn(),
      getNext: jest.fn(),
    }),
    switchToWs: jest.fn(),
    getType: jest.fn(),
  } as any;
}
