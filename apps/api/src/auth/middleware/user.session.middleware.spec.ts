import { BadRequestException, UnauthorizedException } from "@nestjs/common";
import type { Response } from "express";
import type { UserSessionRequest } from "../interfaces/user.session.interface";
import { UserSessionMiddleware } from "./user.session.middleware";

const logger = {
  child: () => logger,
  error: jest.fn(),
  warn: jest.fn(),
  info: jest.fn(),
};

const requestWith = (header: string | undefined): UserSessionRequest =>
  ({
    path: "/api/v2/assignments/1",
    method: "GET",
    headers: header === undefined ? {} : { "user-session": header },
    get: () => undefined,
  }) as unknown as UserSessionRequest;

describe("UserSessionMiddleware", () => {
  const middleware = new UserSessionMiddleware(logger as never);
  const run = (header: string | undefined) => {
    const request = requestWith(header);
    const next = jest.fn();
    middleware.use(request, {} as Response, next);
    return { request, next };
  };

  it("accepts a well-formed session", () => {
    const header = JSON.stringify({
      userId: "a@b.c",
      role: "learner",
      groupId: "g1",
      assignmentId: 42,
      returnUrl: "x",
    });
    const { request, next } = run(header);
    expect(next).toHaveBeenCalledTimes(1);
    expect(request.userSession).toEqual(JSON.parse(header));
  });

  it("accepts a session with optional fields absent", () => {
    const { next } = run(JSON.stringify({ userId: "a@b.c", role: "learner" }));
    expect(next).toHaveBeenCalledTimes(1);
  });

  it("answers 401 when the header is missing", () => {
    expect(() => run(undefined)).toThrow(UnauthorizedException);
  });

  it.each([
    ["null", "null"],
    ["an array", "[1]"],
    ["a JSON string", '"s"'],
    ["a number", "5"],
    ["numeric userId", '{"userId":5,"role":"learner"}'],
    ["numeric role", '{"userId":"a@b.c","role":1}'],
    ["object groupId", '{"userId":"a@b.c","role":"learner","groupId":{}}'],
    [
      "string assignmentId",
      '{"userId":"a@b.c","role":"learner","assignmentId":"7"}',
    ],
    ["unparsable JSON", "{"],
  ])("answers 400 for %s", (_label, header) => {
    const next = jest.fn();
    let caught: unknown;
    try {
      middleware.use(requestWith(header), {} as Response, next);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(BadRequestException);
    expect((caught as BadRequestException).getResponse()).toEqual({
      message: "Invalid user-session header",
      error: "Bad Request",
      statusCode: 400,
    });
    expect(next).not.toHaveBeenCalled();
  });
});
