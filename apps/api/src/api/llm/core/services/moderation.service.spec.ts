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

  it("allows empty content without calling the API", async () => {
    const create = jest.fn();
    const { service } = buildService(create);

    const verdict = await service.assessContent("");

    expect(verdict.action).toBe("allow");
    expect(create).not.toHaveBeenCalled();
  });

  it("includes image parts in the moderation input", async () => {
    const create = jest.fn().mockResolvedValue(moderationResponse({}));
    const { service } = buildService(create);

    await service.assessContent("caption", ["data:image/png;base64,AAAA"]);

    expect(create).toHaveBeenCalledWith({
      model: "omni-moderation-latest",
      input: [
        { type: "text", text: "caption" },
        { type: "image_url", image_url: { url: "data:image/png;base64,AAAA" } },
      ],
    });
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
});
