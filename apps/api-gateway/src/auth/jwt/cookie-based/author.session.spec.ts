import { Request } from "express";
import { sign } from "jsonwebtoken";
import { JwtConfigService } from "../jwt.config.service";
import { JwtCookieStrategy } from "./jwt.cookie.strategy";
import {
  dedupeAuthenticationCookieHeader,
  selectAuthenticationCookie,
} from "./jwt.cookie.extractor";

const secret = "local-session-test-secret";
const token = (claims: Record<string, unknown> = {}, key = secret) =>
  sign(
    {
      userID: "author@example.test",
      role: "author",
      assignmentID: 4892,
      groupID: "shared-group",
      gradingCallbackRequired: false,
      ...claims,
    },
    key,
    { expiresIn: "1h" },
  );

function authenticate(
  cookie: string,
  headers: Request["headers"] = {},
  url = "/api/v1/user-session",
) {
  const config = { jwtConstants: { secret } } as JwtConfigService;
  const strategy = new JwtCookieStrategy(config);
  const response = {
    cookie: jest.fn<
      void,
      [
        string,
        string,
        { httpOnly: boolean; sameSite: string; path: string; maxAge: number },
      ]
    >(),
    clearCookie: jest.fn(),
  };
  const request = {
    headers: { cookie, ...headers },
    originalUrl: url,
    cookies: Object.fromEntries(
      cookie.split("; ").map((pair) => {
        const index = pair.indexOf("=");
        return [pair.slice(0, index), pair.slice(index + 1)];
      }),
    ),
    res: response,
  } as unknown as Request;
  const result = new Promise<unknown>((resolve, reject) => {
    strategy.success = resolve;
    strategy.fail = () => reject(new Error("Unauthorized"));
    strategy.error = reject;
    strategy.authenticate(request, {});
  });
  return { result, response };
}
const context = { "x-mark-author-assignment": "4892" };

describe("verified author sessions", () => {
  it("preserves the signed author token during a learner preview and forwards the same token", async () => {
    const author = token();
    const learner = token({ role: "learner" });
    const cookie = `authentication=${learner}; mark_author_4892=${author}`;
    const { result } = authenticate(cookie, context);
    await expect(result).resolves.toMatchObject({
      role: "author",
      assignmentId: 4892,
    });
    expect(dedupeAuthenticationCookieHeader(cookie, context)).toBe(
      `authentication=${author}`,
    );
    expect(selectAuthenticationCookie({ headers: { cookie } }).token).toBe(
      learner,
    );
  });

  it.each([
    ["invalid signature", () => token({}, "wrong-secret")],
    ["expired author", () => token({ exp: 1, iat: 0 })],
  ])(
    "rejects %s before setting an author cookie",
    async (_name, makeInvalid) => {
      // Explicit expiration uses sign without expiresIn.
      const invalid =
        _name === "expired author"
          ? sign(
              {
                userID: "author@example.test",
                role: "author",
                assignmentID: 4892,
                exp: 1,
              },
              secret,
            )
          : makeInvalid();
      const { result, response } = authenticate(
        `authentication=${token({ role: "learner" })}; mark_author_4892=${invalid}`,
        context,
      );
      await expect(result).rejects.toThrow();
      expect(response.cookie).not.toHaveBeenCalled();
    },
  );

  it("does not revive an author cookie after the current session expired", async () => {
    const expired = sign(
      { userID: "author@example.test", role: "learner", exp: 1 },
      secret,
    );
    await expect(
      authenticate(
        `authentication=${expired}; mark_author_4892=${token()}`,
        context,
      ).result,
    ).rejects.toThrow();
  });

  it("does not trust a forged current-session identity", async () => {
    await expect(
      authenticate(
        `authentication=${token({ role: "learner" }, "wrong-secret")}; mark_author_4892=${token()}`,
        context,
      ).result,
    ).rejects.toThrow();
  });

  it("does not revive an author cookie after signing out", async () => {
    await expect(
      authenticate(`mark_author_4892=${token()}`, context).result,
    ).rejects.toThrow();
  });

  it("does not borrow the previous account's author session", async () => {
    await expect(
      authenticate(
        `authentication=${token({ userID: "other@example.test", role: "learner" })}; mark_author_4892=${token()}`,
        context,
      ).result,
    ).rejects.toThrow();
  });

  it("rejects saves from an editor opened by another account", async () => {
    await expect(
      authenticate(
        `authentication=${token({ userID: "other@example.test" })}`,
        {
          ...context,
          "x-mark-author-user": "author@example.test",
        },
      ).result,
    ).rejects.toThrow();
  });

  it("rejects another quiz even without browser context headers", async () => {
    await expect(
      authenticate(
        `authentication=${token()}`,
        {},
        "/api/v2/assignments/4941/questions",
      ).result,
    ).rejects.toThrow();
  });

  it("selects concurrent quiz sessions independently", async () => {
    const cookie = `authentication=${token({ assignmentID: 4941 })}; mark_author_4892=${token()}`;
    await expect(authenticate(cookie, context).result).resolves.toMatchObject({
      assignmentId: 4892,
    });
    await expect(
      authenticate(cookie, { "x-mark-author-assignment": "4941" }).result,
    ).resolves.toMatchObject({ assignmentId: 4941 });
  });

  it("persists a verified author token with bounded lifetime and HttpOnly", async () => {
    const author = token();
    const { result, response } = authenticate(
      `authentication=${author}`,
      context,
    );
    await result;
    expect(response.cookie).toHaveBeenCalledWith(
      "mark_author_4892",
      author,
      expect.objectContaining({
        httpOnly: true,
        sameSite: "lax",
        path: "/",
        maxAge: expect.any(Number) as number,
      }),
    );
    expect(response.cookie.mock.calls[0][2].maxAge).toBeLessThanOrEqual(
      3_600_000,
    );
  });
});
