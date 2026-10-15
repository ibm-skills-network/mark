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
    clearCookie: jest.fn<
      void,
      [
        string,
        { httpOnly: boolean; secure: boolean; sameSite: string; path: string },
      ]
    >(),
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

describe("learner sessions across author launches", () => {
  const learnerContext = { "x-mark-learner-assignment": "4892" };
  it("preserves a verified learner session and forwards its grade callback token", async () => {
    const learner = token({ role: "learner", gradingCallbackRequired: true });
    const cookie = `authentication=${token()}; mark_learner_4892=${learner}`;
    await expect(
      authenticate(
        cookie,
        learnerContext,
        "/api/v2/assignments/4892/attempts/17",
      ).result,
    ).resolves.toMatchObject({
      role: "learner",
      assignmentId: 4892,
      gradingCallbackRequired: true,
    });
    expect(dedupeAuthenticationCookieHeader(cookie, learnerContext)).toBe(
      `authentication=${learner}`,
    );
  });
  it("saves a verified learner cookie before the author launch", async () => {
    const learner = token({ role: "learner" });
    const { result, response } = authenticate(
      `authentication=${learner}`,
      learnerContext,
    );
    await result;
    expect(response.cookie).toHaveBeenCalledWith(
      "mark_learner_4892",
      learner,
      expect.objectContaining({ httpOnly: true }),
    );
  });
  it.each([
    ["signed out", ""],
    ["account changed", token({ userID: "other@example.test" })],
    ["forged current session", token({}, "wrong-secret")],
    [
      "expired current session",
      sign({ userID: "author@example.test", exp: 1 }, secret),
    ],
  ])("rejects learner recovery when %s", async (_name, current) => {
    await expect(
      authenticate(
        `authentication=${current}; mark_learner_4892=${token({ role: "learner" })}`,
        learnerContext,
      ).result,
    ).rejects.toThrow();
  });
  it("rejects an expired saved learner token", async () => {
    const expired = sign(
      {
        userID: "author@example.test",
        role: "learner",
        assignmentID: 4892,
        exp: 1,
      },
      secret,
    );
    await expect(
      authenticate(
        `authentication=${token()}; mark_learner_4892=${expired}`,
        learnerContext,
      ).result,
    ).rejects.toThrow();
  });
  it("does not grant learner role from a context hint", async () => {
    await expect(
      authenticate(`authentication=${token()}`, learnerContext).result,
    ).rejects.toThrow();
  });
  it("keeps deliberate author previews on their signed author session", async () => {
    const cookie = `authentication=${token({ role: "learner" })}; mark_author_4892=${token()}`;
    await expect(
      authenticate(cookie, {
        referer: "https://mark.example/learner/4892/questions?authorMode=true",
      }).result,
    ).resolves.toMatchObject({ role: "author" });
  });
  it("rejects a learner request for another assignment", async () => {
    await expect(
      authenticate(
        `authentication=${token()}; mark_learner_4892=${token({ role: "learner" })}`,
        learnerContext,
        "/api/v2/assignments/4941/attempts/17",
      ).result,
    ).rejects.toThrow();
  });
});

describe("saved session cookie cleanup", () => {
  it("cleans both roles when the active cookie is unchanged", async () => {
    const now = Math.floor(Date.now() / 1000);
    const author = token({ iat: now - 100 });
    const cookies = [
      `authentication=${author}`,
      `mark_author_4892=${author}`,
      "theme=dark",
      ...["author", "learner"].flatMap((role) =>
        Array.from({ length: 5 }, (_, index) => {
          const assignmentID = 5000 + index;
          return `mark_${role}_${assignmentID}=${token({
            role,
            assignmentID,
            iat: now - index,
          })}`;
        }),
      ),
    ];
    const { result, response } = authenticate(cookies.join("; "), context);
    await result;

    expect(response.cookie).not.toHaveBeenCalled();
    expect(
      response.clearCookie.mock.calls.map(([name]) => name).sort(),
    ).toEqual(
      ["mark_author_5003", "mark_author_5004", "mark_learner_5004"].sort(),
    );
    expect(response.clearCookie).toHaveBeenCalledWith(
      "mark_author_5004",
      expect.objectContaining({ httpOnly: true, sameSite: "lax", path: "/" }),
    );
  });

  it.each([false, true])(
    "shares the byte budget across roles and protects the active assignment (already saved: %s)",
    async (alreadySaved) => {
      const now = Math.floor(Date.now() / 1000);
      const author = token({ iat: now - 100, padding: "x".repeat(1600) });
      const saved = [
        [
          "mark_learner_5001",
          token({
            role: "learner",
            assignmentID: 5001,
            iat: now - 1,
            padding: "x".repeat(1600),
          }),
        ],
        [
          "mark_author_5002",
          token({
            assignmentID: 5002,
            iat: now - 2,
            padding: "x".repeat(1600),
          }),
        ],
        [
          "mark_learner_5003",
          token({
            role: "learner",
            assignmentID: 5003,
            iat: now - 3,
            padding: "x".repeat(1600),
          }),
        ],
      ];
      const cookie = [
        `authentication=${author}`,
        ...(alreadySaved ? [`mark_author_4892=${author}`] : []),
        ...saved.map(([name, value]) => `${name}=${value}`),
      ].join("; ");
      const { result, response } = authenticate(cookie, context);
      await expect(result).resolves.toMatchObject({ assignmentId: 4892 });

      const removed = response.clearCookie.mock.calls.map(([name]) => name);
      expect(removed.sort()).toEqual(
        ["mark_author_5002", "mark_learner_5003"].sort(),
      );
      const retained = [
        ["mark_author_4892", author],
        ...saved.filter(([name]) => !removed.includes(name)),
      ];
      const bytes = Buffer.byteLength(
        retained
          .map(([name, value]) => `${name}=${encodeURIComponent(value)}; `)
          .join(""),
      );
      expect(bytes).toBeLessThanOrEqual(6 * 1024);
      expect(response.cookie).toHaveBeenCalledTimes(alreadySaved ? 0 : 1);
      expect(dedupeAuthenticationCookieHeader(cookie, context)).toBe(
        `authentication=${author}`,
      );
    },
  );

  it("does not rewrite cookies when saved sessions fit the limits", async () => {
    const author = token();
    const cookie = `authentication=${author}; mark_author_4892=${author}; mark_learner_4892=${token({ role: "learner" })}; theme=dark`;
    const { result, response } = authenticate(cookie, context);
    await result;
    expect(response.cookie).not.toHaveBeenCalled();
    expect(response.clearCookie).not.toHaveBeenCalled();
  });

  it("does not clean cookies when authentication fails", async () => {
    const cookie = `authentication=${token({}, "wrong-secret")}; mark_author_5001=${token({ assignmentID: 5001 })}`;
    const { result, response } = authenticate(cookie, context);
    await expect(result).rejects.toThrow();
    expect(response.cookie).not.toHaveBeenCalled();
    expect(response.clearCookie).not.toHaveBeenCalled();
  });
});
