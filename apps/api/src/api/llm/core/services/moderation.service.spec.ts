import { ModerationService, parseSevereCategories } from "./moderation.service";

function mockLogger() {
  const logger: any = {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
    child: jest.fn(),
  };
  logger.child.mockReturnValue(logger);
  return logger;
}

function buildService(createMock: jest.Mock) {
  const service: any = Object.create(ModerationService.prototype);
  service.logger = mockLogger();
  service.severeCategories = new Set(["sexual/minors"]);
  service.openAiClient = { moderations: { create: createMock } };
  return { service, logger: service.logger };
}

function moderationResponse(categories: Record<string, boolean>) {
  return {
    results: [
      {
        flagged: Object.values(categories).some(Boolean),
        categories,
        category_scores: {},
      },
    ],
  };
}

describe("ModerationService.assessContent", () => {
  it("allows clean content", async () => {
    const create = jest.fn().mockResolvedValue(moderationResponse({}));
    const { service } = buildService(create);

    const verdict = await service.assessContent("a normal essay");

    expect(verdict).toEqual({
      action: "allow",
      flaggedCategories: [],
      severeCategories: [],
    });
    expect(create).toHaveBeenCalledWith({
      model: "omni-moderation-latest",
      input: [{ type: "text", text: "a normal essay" }],
    });
  });

  it("returns allow_with_log for a non-severe flag (the rootkit case)", async () => {
    const create = jest
      .fn()
      .mockResolvedValue(moderationResponse({ violence: true }));
    const { service } = buildService(create);

    const verdict = await service.assessContent("describe a rootkit");

    expect(verdict.action).toBe("allow_with_log");
    expect(verdict.flaggedCategories).toEqual(["violence"]);
    expect(verdict.severeCategories).toEqual([]);
  });

  it("returns block_severe when a severe category flags", async () => {
    const create = jest
      .fn()
      .mockResolvedValue(
        moderationResponse({ "sexual/minors": true, sexual: true }),
      );
    const { service } = buildService(create);

    const verdict = await service.assessContent("bad");

    expect(verdict.action).toBe("block_severe");
    expect(verdict.severeCategories).toEqual(["sexual/minors"]);
  });

  it("fails open (allow) when the moderation API errors", async () => {
    const create = jest.fn().mockRejectedValue(new Error("api down"));
    const { service, logger } = buildService(create);

    const verdict = await service.assessContent("anything");

    expect(verdict.action).toBe("allow");
    expect(logger.error).toHaveBeenCalled();
  });

  it("fails open (allow) when the client cannot be constructed (missing key)", async () => {
    const service: any = Object.create(ModerationService.prototype);
    service.logger = mockLogger();
    service.severeCategories = new Set(["sexual/minors"]);
    service.getClient = jest.fn(() => {
      throw new Error("no key");
    });

    const verdict = await service.assessContent("x");

    expect(verdict).toEqual({
      action: "allow",
      flaggedCategories: [],
      severeCategories: [],
    });
    expect(service.logger.error).toHaveBeenCalled();
  });

  it("allows empty content without calling the API", async () => {
    const create = jest.fn();
    const { service } = buildService(create);

    const verdict = await service.assessContent("");

    expect(verdict.action).toBe("allow");
    expect(create).not.toHaveBeenCalled();
  });

  it("aggregates flagged categories across multiple results", async () => {
    const create = jest.fn().mockResolvedValue({
      results: [
        {
          flagged: false,
          categories: {},
          category_scores: {},
        },
        {
          flagged: true,
          categories: { "sexual/minors": true },
          category_scores: {},
        },
      ],
    });
    const { service } = buildService(create);

    const verdict = await service.assessContent("caption", [
      "data:image/png;base64,AAAA",
    ]);

    expect(verdict.action).toBe("block_severe");
    expect(verdict.severeCategories).toEqual(["sexual/minors"]);
  });

  it("splits text and images into two separate moderation calls", async () => {
    const create = jest.fn().mockResolvedValue(moderationResponse({}));
    const { service } = buildService(create);

    await service.assessContent("caption", ["data:image/png;base64,AAAA"]);

    expect(create).toHaveBeenCalledTimes(2);
    expect(create).toHaveBeenNthCalledWith(1, {
      model: "omni-moderation-latest",
      input: [{ type: "text", text: "caption" }],
    });
    expect(create).toHaveBeenNthCalledWith(2, {
      model: "omni-moderation-latest",
      input: [
        { type: "image_url", image_url: { url: "data:image/png;base64,AAAA" } },
      ],
    });
  });

  it("still moderates text via its own call when the image call fails, and does not fail open on the text verdict", async () => {
    const create = jest
      .fn()
      .mockResolvedValueOnce(moderationResponse({}))
      .mockRejectedValueOnce(new Error("could not fetch image url"));
    const { service, logger } = buildService(create);

    const verdict = await service.assessContent("clean caption", [
      "https://example.com/unreachable.png",
    ]);

    expect(create).toHaveBeenCalledTimes(2);
    expect(verdict.action).toBe("allow");
    expect(logger.error).toHaveBeenCalledWith(expect.stringContaining("image"));
  });

  it("still returns block_severe from the text call when the image call fails", async () => {
    const create = jest
      .fn()
      .mockResolvedValueOnce(moderationResponse({ "sexual/minors": true }))
      .mockRejectedValueOnce(new Error("could not fetch image url"));
    const { service, logger } = buildService(create);

    const verdict = await service.assessContent("bad caption", [
      "https://example.com/unreachable.png",
    ]);

    expect(create).toHaveBeenCalledTimes(2);
    expect(verdict.action).toBe("block_severe");
    expect(verdict.severeCategories).toEqual(["sexual/minors"]);
    expect(logger.error).toHaveBeenCalledWith(expect.stringContaining("image"));
  });
});

describe("ModerationService.validateContent (authoring gate)", () => {
  it("passes ordinary flags and logs them", async () => {
    const create = jest
      .fn()
      .mockResolvedValue(moderationResponse({ violence: true }));
    const { service, logger } = buildService(create);

    await expect(service.validateContent("pentest question")).resolves.toBe(
      true,
    );
    expect(logger.warn).toHaveBeenCalledWith(
      "authoring.moderation.flagged",
      expect.objectContaining({ categories: ["violence"] }),
    );
  });

  it("fails only on severe categories", async () => {
    const create = jest
      .fn()
      .mockResolvedValue(moderationResponse({ "sexual/minors": true }));
    const { service } = buildService(create);

    await expect(service.validateContent("bad")).resolves.toBe(false);
  });
});

describe("parseSevereCategories", () => {
  it("defaults to sexual/minors", () => {
    expect([...parseSevereCategories("", mockLogger())]).toEqual([
      "sexual/minors",
    ]);
  });

  it("parses a csv and ignores unknown names with a warning", () => {
    const logger = mockLogger();
    const parsed = parseSevereCategories(
      "sexual/minors, harassment/threatening, not-a-category",
      logger,
    );
    expect(parsed).toEqual(
      new Set(["sexual/minors", "harassment/threatening"]),
    );
    expect(logger.warn).toHaveBeenCalled();
  });

  it("falls back to the default set when every name is unknown", () => {
    const logger = mockLogger();
    const parsed = parseSevereCategories("bogus-one, bogus-two", logger);

    expect(parsed).toEqual(new Set(["sexual/minors"]));
    expect(logger.warn).toHaveBeenCalled();
  });
});
