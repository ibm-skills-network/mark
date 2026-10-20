import { Request } from "express";
import { sign } from "jsonwebtoken";
import { JwtConfigService } from "../jwt.config.service";
import { JwtCookieStrategy } from "./jwt.cookie.strategy";
import {
  dedupeAuthenticationCookieHeader,
  quizSessionContext,
  selectAuthenticationCookie,
} from "./jwt.cookie.extractor";
import { SavedSessionStore } from "./saved-session.store";

const secret = "local-session-test-secret";
const storeId = "7f0c6c1e-3c1a-4c55-9a8e-2b8f6f1d0a11";
const uuid = /^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/;
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

/** `saved` maps "role:assignmentId" to the token the guard would load. */
function authenticate(
  cookie: string,
  headers: Request["headers"] = {},
  url = "/api/v1/user-session",
  saved: Record<string, string> = {},
) {
  const config = { jwtConstants: { secret } } as JwtConfigService;
  const store = {
    save: jest
      .fn<Promise<void>, [string, string, number, string]>()
      .mockResolvedValue(),
  };
  const strategy = new JwtCookieStrategy(
    config,
    store as unknown as SavedSessionStore,
  );
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
  const quiz = quizSessionContext({ cookie, ...headers });
  const request = {
    headers: { cookie, ...headers },
    originalUrl: url,
    cookies: Object.fromEntries(
      cookie.split("; ").map((pair) => {
        const index = pair.indexOf("=");
        return [pair.slice(0, index), pair.slice(index + 1)];
      }),
    ),
    savedSession: quiz && saved[`${quiz.role}:${quiz.assignmentId}`],
    res: response,
  } as unknown as Request;
  const result = new Promise<unknown>((resolve, reject) => {
    strategy.success = resolve;
    strategy.fail = () => reject(new Error("Unauthorized"));
    strategy.error = reject;
    strategy.authenticate(request, {});
  });
  return { result, response, store };
}
const context = { "x-mark-author-assignment": "4892" };

describe("verified author sessions", () => {
  it("preserves the signed author token during a learner preview and forwards the same token", async () => {
    const author = token();
    const learner = token({ role: "learner" });
    const cookie = `authentication=${learner}`;
    const { result } = authenticate(cookie, context, undefined, {
      "author:4892": author,
    });
    await expect(result).resolves.toMatchObject({
      role: "author",
      assignmentId: 4892,
    });
    expect(dedupeAuthenticationCookieHeader(cookie, context, author)).toBe(
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
    "rejects %s before saving an author session",
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
      const { result, response, store } = authenticate(
        `authentication=${token({ role: "learner" })}; mark_saved_sessions=${storeId}`,
        context,
        undefined,
        { "author:4892": invalid },
      );
      await expect(result).rejects.toThrow();
      expect(response.cookie).not.toHaveBeenCalled();
      expect(store.save).not.toHaveBeenCalled();
    },
  );

  it("does not revive a saved author session after the current session expired", async () => {
    const expired = sign(
      { userID: "author@example.test", role: "learner", exp: 1 },
      secret,
    );
    await expect(
      authenticate(`authentication=${expired}`, context, undefined, {
        "author:4892": token(),
      }).result,
    ).rejects.toThrow();
  });

  it("does not trust a forged current-session identity", async () => {
    await expect(
      authenticate(
        `authentication=${token({ role: "learner" }, "wrong-secret")}`,
        context,
        undefined,
        { "author:4892": token() },
      ).result,
    ).rejects.toThrow();
  });

  it("does not revive a saved author session after signing out", async () => {
    await expect(
      authenticate(`theme=dark`, context, undefined, {
        "author:4892": token(),
      }).result,
    ).rejects.toThrow();
  });

  it("does not borrow the previous account's author session", async () => {
    await expect(
      authenticate(
        `authentication=${token({ userID: "other@example.test", role: "learner" })}`,
        context,
        undefined,
        { "author:4892": token() },
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
    const cookie = `authentication=${token({ assignmentID: 4941 })}`;
    const saved = { "author:4892": token() };
    await expect(
      authenticate(cookie, context, undefined, saved).result,
    ).resolves.toMatchObject({ assignmentId: 4892 });
    await expect(
      authenticate(
        cookie,
        { "x-mark-author-assignment": "4941" },
        undefined,
        saved,
      ).result,
    ).resolves.toMatchObject({ assignmentId: 4941 });
  });

  it("sets an HttpOnly store id cookie, then saves once the browser returns it", async () => {
    const author = token();
    const first = authenticate(`authentication=${author}`, context);
    await first.result;
    expect(first.store.save).not.toHaveBeenCalled();
    expect(first.response.cookie).toHaveBeenCalledTimes(1);
    const [[name, id, options]] = first.response.cookie.mock.calls;
    expect(name).toBe("mark_saved_sessions");
    expect(id).toMatch(uuid);
    expect(options).toMatchObject({
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      maxAge: 3 * 24 * 60 * 60 * 1000,
    });

    const second = authenticate(
      `authentication=${author}; mark_saved_sessions=${id}`,
      context,
    );
    await second.result;
    expect(second.store.save).toHaveBeenCalledWith(id, "author", 4892, author);
  });
});

describe("learner sessions across author launches", () => {
  const learnerContext = { "x-mark-learner-assignment": "4892" };
  it("preserves a verified learner session and forwards its grade callback token", async () => {
    const learner = token({ role: "learner", gradingCallbackRequired: true });
    const cookie = `authentication=${token()}`;
    await expect(
      authenticate(
        cookie,
        learnerContext,
        "/api/v2/assignments/4892/attempts/17",
        { "learner:4892": learner },
      ).result,
    ).resolves.toMatchObject({
      role: "learner",
      assignmentId: 4892,
      gradingCallbackRequired: true,
    });
    expect(
      dedupeAuthenticationCookieHeader(cookie, learnerContext, learner),
    ).toBe(`authentication=${learner}`);
  });
  it("saves a verified learner session before the author launch", async () => {
    const learner = token({ role: "learner" });
    const { result, store } = authenticate(
      `authentication=${learner}; mark_saved_sessions=${storeId}`,
      learnerContext,
    );
    await result;
    expect(store.save).toHaveBeenCalledWith(storeId, "learner", 4892, learner);
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
      authenticate(`authentication=${current}`, learnerContext, undefined, {
        "learner:4892": token({ role: "learner" }),
      }).result,
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
      authenticate(`authentication=${token()}`, learnerContext, undefined, {
        "learner:4892": expired,
      }).result,
    ).rejects.toThrow();
  });
  it("does not grant learner role from a context hint", async () => {
    await expect(
      authenticate(`authentication=${token()}`, learnerContext).result,
    ).rejects.toThrow();
  });
  it("keeps deliberate author previews on their signed author session", async () => {
    await expect(
      authenticate(
        `authentication=${token({ role: "learner" })}`,
        {
          referer:
            "https://mark.example/learner/4892/questions?authorMode=true",
        },
        undefined,
        { "author:4892": token() },
      ).result,
    ).resolves.toMatchObject({ role: "author" });
  });
  it("rejects a learner request for another assignment", async () => {
    await expect(
      authenticate(
        `authentication=${token()}`,
        learnerContext,
        "/api/v2/assignments/4941/attempts/17",
        { "learner:4892": token({ role: "learner" }) },
      ).result,
    ).rejects.toThrow();
  });
});

describe("saved session store", () => {
  it("reuses the browser's store id", async () => {
    const { result, response, store } = authenticate(
      `authentication=${token()}; mark_saved_sessions=${storeId}`,
      context,
    );
    await result;
    expect(store.save.mock.calls[0][0]).toBe(storeId);
    expect(response.cookie.mock.calls[0][1]).toBe(storeId);
  });

  it("replaces a store id that is not a GUID without saving under it", async () => {
    const { result, response, store } = authenticate(
      `authentication=${token()}; mark_saved_sessions=not-a-guid`,
      context,
    );
    await result;
    expect(response.cookie.mock.calls[0][1]).toMatch(uuid);
    expect(store.save).not.toHaveBeenCalled();
  });

  it("does not save for a browser that keeps dropping the store cookie", async () => {
    const ids = [];
    for (let attempt = 0; attempt < 3; attempt++) {
      const { result, response, store } = authenticate(
        `authentication=${token()}`,
        context,
      );
      await result;
      expect(store.save).not.toHaveBeenCalled();
      ids.push(response.cookie.mock.calls[0][1]);
    }
    expect(new Set(ids).size).toBe(3);
  });

  it("does not save again when the store already holds the active token", async () => {
    const author = token();
    const { result, response, store } = authenticate(
      `authentication=${author}; mark_saved_sessions=${storeId}`,
      context,
      undefined,
      { "author:4892": author },
    );
    await result;
    expect(store.save).not.toHaveBeenCalled();
    expect(response.cookie).not.toHaveBeenCalled();
  });

  it("does not save when resuming from the store", async () => {
    const { result, store } = authenticate(
      `authentication=${token({ assignmentID: 4941 })}; mark_saved_sessions=${storeId}`,
      context,
      undefined,
      { "author:4892": token() },
    );
    await expect(result).resolves.toMatchObject({ assignmentId: 4892 });
    expect(store.save).not.toHaveBeenCalled();
  });

  it("saves a newer launch over the stored session", async () => {
    const now = Math.floor(Date.now() / 1000);
    const newer = token({ iat: now });
    const { result, store } = authenticate(
      `authentication=${newer}; mark_saved_sessions=${storeId}`,
      context,
      undefined,
      { "author:4892": token({ iat: now - 60 }) },
    );
    await result;
    expect(store.save).toHaveBeenCalledWith(storeId, "author", 4892, newer);
  });

  it("does not save without quiz context", async () => {
    const { result, response, store } = authenticate(
      `authentication=${token()}; mark_saved_sessions=${storeId}`,
    );
    await result;
    expect(store.save).not.toHaveBeenCalled();
    expect(response.cookie).not.toHaveBeenCalled();
  });

  it("ignores and clears per-quiz session cookies", async () => {
    const cookie = [
      `authentication=${token({ role: "learner" })}`,
      `mark_author_4892=${token()}`,
      `mark_learner_5001=${token({ role: "learner", assignmentID: 5001 })}`,
      "theme=dark",
    ].join("; ");
    const { result, response } = authenticate(cookie, context);
    await expect(result).rejects.toThrow();

    const cleanup = authenticate(cookie);
    await cleanup.result;
    expect(
      cleanup.response.clearCookie.mock.calls.map(([name]) => name).sort(),
    ).toEqual(["mark_author_4892", "mark_learner_5001"]);
    expect(cleanup.response.clearCookie).toHaveBeenCalledWith(
      "mark_author_4892",
      expect.objectContaining({ httpOnly: true, sameSite: "lax", path: "/" }),
    );
    expect(response.clearCookie).not.toHaveBeenCalled();
  });

  it("does not touch cookies when authentication fails", async () => {
    const cookie = `authentication=${token({}, "wrong-secret")}; mark_author_5001=${token({ assignmentID: 5001 })}; mark_saved_sessions=${storeId}`;
    const { result, response, store } = authenticate(cookie, context);
    await expect(result).rejects.toThrow();
    expect(response.cookie).not.toHaveBeenCalled();
    expect(response.clearCookie).not.toHaveBeenCalled();
    expect(store.save).not.toHaveBeenCalled();
  });

  it("keeps the browser to one store id cookie across many quizzes", async () => {
    const jar = new Map<string, string>();
    const stored = new Map<string, string>();
    const storeIds = new Set<string>();
    for (let quiz = 0; quiz < 8; quiz++) {
      const role = quiz % 2 === 0 ? "learner" : "author";
      const assignmentId = 6000 + quiz;
      const key = `${role}:${assignmentId}`;
      jar.set("authentication", token({ role, assignmentID: assignmentId }));
      for (let visit = 0; visit < 2; visit++) {
        const cookie = [...jar].map(([name, value]) => `${name}=${value}`);
        const saved = stored.get(key);
        const { result, response, store } = authenticate(
          cookie.join("; "),
          { [`x-mark-${role}-assignment`]: String(assignmentId) },
          undefined,
          saved ? { [key]: saved } : {},
        );
        await result;
        for (const [name, value] of response.cookie.mock.calls) {
          expect(name).toBe("mark_saved_sessions");
          jar.set(name, value);
        }
        for (const [id, savedRole, savedId, savedToken] of store.save.mock
          .calls) {
          expect(id).toBe(jar.get("mark_saved_sessions"));
          stored.set(`${savedRole}:${savedId}`, savedToken);
        }
        expect(response.clearCookie).not.toHaveBeenCalled();
        expect([...jar.keys()].sort()).toEqual([
          "authentication",
          "mark_saved_sessions",
        ]);
        storeIds.add(jar.get("mark_saved_sessions") ?? "");
      }
    }
    expect(storeIds.size).toBe(1);
    expect(stored.size).toBe(8);
  });

  describe("Secure attribute", () => {
    const nodeEnvironment = process.env.NODE_ENV;
    afterEach(() => {
      process.env.NODE_ENV = nodeEnvironment;
    });

    it.each([
      ["production", true],
      ["development", false],
    ])(
      "sets and clears cookies with secure in %s: %p",
      async (mode, secure) => {
        process.env.NODE_ENV = mode;
        const { result, response } = authenticate(
          `authentication=${token()}; mark_learner_5001=${token({ role: "learner", assignmentID: 5001 })}`,
          context,
        );
        await result;
        expect(response.cookie).toHaveBeenCalledWith(
          "mark_saved_sessions",
          expect.stringMatching(uuid),
          expect.objectContaining({ secure, path: "/" }),
        );
        expect(response.clearCookie).toHaveBeenCalledWith(
          "mark_learner_5001",
          expect.objectContaining({ secure, path: "/" }),
        );
      },
    );
  });
});

const withStore = (current: string) =>
  `authentication=${current}; mark_saved_sessions=${storeId}`;

describe("saved session selection", () => {
  const quiz = { "x-mark-learner-assignment": "4892" };
  const now = Math.floor(Date.now() / 1000);

  it("keeps and forwards the current launch when the saved session is another account's", async () => {
    const other = token({
      userID: "other@example.test",
      role: "learner",
      iat: now,
    });
    const launch = token({ role: "learner", iat: now - 600 });
    const { result, store } = authenticate(withStore(launch), quiz, undefined, {
      "learner:4892": other,
    });
    await expect(result).resolves.toMatchObject({
      userId: "author@example.test",
      role: "learner",
      assignmentId: 4892,
    });
    expect(
      dedupeAuthenticationCookieHeader(withStore(launch), quiz, other),
    ).toBe(`mark_saved_sessions=${storeId}; authentication=${launch}`);
    expect(store.save).toHaveBeenCalledWith(storeId, "learner", 4892, launch);
  });

  it("forwards a newer relaunch instead of the older saved session", async () => {
    const older = token({ role: "learner", iat: now - 600 });
    const newer = token({ role: "learner", iat: now });
    const { result, store } = authenticate(withStore(newer), quiz, undefined, {
      "learner:4892": older,
    });
    await expect(result).resolves.toMatchObject({ assignmentId: 4892 });
    expect(
      dedupeAuthenticationCookieHeader(withStore(newer), quiz, older),
    ).toBe(`mark_saved_sessions=${storeId}; authentication=${newer}`);
    expect(store.save).toHaveBeenCalledWith(storeId, "learner", 4892, newer);
  });

  it("uses a saved session newer than the current launch of the same quiz", async () => {
    const stored = token({
      role: "learner",
      iat: now,
      lis_outcome_service_url: "https://lms.example/stored",
    });
    const older = token({
      role: "learner",
      iat: now - 600,
      lis_outcome_service_url: "https://lms.example/older",
    });
    const { result, response, store } = authenticate(
      withStore(older),
      quiz,
      undefined,
      { "learner:4892": stored },
    );
    await expect(result).resolves.toMatchObject({
      lisOutcomeServiceUrl: "https://lms.example/stored",
    });
    expect(
      dedupeAuthenticationCookieHeader(withStore(older), quiz, stored),
    ).toBe(`mark_saved_sessions=${storeId}; authentication=${stored}`);
    expect(store.save).not.toHaveBeenCalled();
    expect(response.cookie).not.toHaveBeenCalled();
  });
});
