import { AIUsageType } from "@prisma/client";
import { AiFeatureComponent } from "./ai-feature-flags.constants";
import { AiFeatureFlagsService } from "./ai-feature-flags.service";
import { AiTemporarilyDisabledException } from "./ai-temporarily-disabled.exception";

const makeLogger = () =>
  ({
    child: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }),
  }) as any;

/** Mock PrismaService whose aiFeatureFlag table returns `rows` from findMany. */
const makePrisma = (rows: any[] = []) =>
  ({
    aiFeatureFlag: {
      findMany: jest.fn().mockResolvedValue(rows),
      upsert: jest.fn().mockResolvedValue(undefined),
    },
  }) as any;

const ENV_KEYS = [
  "AI_FEATURES_DISABLED",
  "AI_GRADING_DISABLED",
  "AI_CHAT_DISABLED",
  "AI_AUTHORING_DISABLED",
];

describe("AiFeatureFlagsService", () => {
  let saved: Record<string, string | undefined>;

  beforeEach(() => {
    saved = {};
    for (const key of ENV_KEYS) {
      saved[key] = process.env[key];
      delete process.env[key];
    }
  });

  afterEach(() => {
    for (const key of ENV_KEYS) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  });

  // ---- Env-derived snapshot (no DB load; construction only) ----

  it("defaults to all components enabled when no env vars are set", () => {
    const service = new AiFeatureFlagsService(makePrisma(), makeLogger());
    expect(service.isEnabled(AiFeatureComponent.GRADING)).toBe(true);
    expect(service.isEnabled(AiFeatureComponent.CHAT)).toBe(true);
    expect(service.isEnabled(AiFeatureComponent.AUTHORING)).toBe(true);
    expect(service.getStatus()).toEqual({
      grading: true,
      chat: true,
      authoring: true,
    });
  });

  it("disables only the component named by its env var", () => {
    process.env.AI_GRADING_DISABLED = "true";
    const service = new AiFeatureFlagsService(makePrisma(), makeLogger());
    expect(service.isDisabled(AiFeatureComponent.GRADING)).toBe(true);
    expect(service.isDisabled(AiFeatureComponent.CHAT)).toBe(false);
    expect(service.isDisabled(AiFeatureComponent.AUTHORING)).toBe(false);
  });

  it("accepts the 1/true/yes idiom (case-insensitive) and ignores others", () => {
    process.env.AI_CHAT_DISABLED = "YES";
    expect(
      new AiFeatureFlagsService(makePrisma(), makeLogger()).isDisabled(
        AiFeatureComponent.CHAT,
      ),
    ).toBe(true);

    process.env.AI_CHAT_DISABLED = "false";
    expect(
      new AiFeatureFlagsService(makePrisma(), makeLogger()).isDisabled(
        AiFeatureComponent.CHAT,
      ),
    ).toBe(false);
  });

  it("master switch forces every component disabled", () => {
    process.env.AI_FEATURES_DISABLED = "1";
    const service = new AiFeatureFlagsService(makePrisma(), makeLogger());
    expect(service.isDisabled(AiFeatureComponent.GRADING)).toBe(true);
    expect(service.isDisabled(AiFeatureComponent.CHAT)).toBe(true);
    expect(service.isDisabled(AiFeatureComponent.AUTHORING)).toBe(true);
    expect(service.getStatus()).toEqual({
      grading: false,
      chat: false,
      authoring: false,
    });
  });

  it("maps LLM usage types to the governing component", () => {
    process.env.AI_GRADING_DISABLED = "true";
    const service = new AiFeatureFlagsService(makePrisma(), makeLogger());
    expect(service.isDisabledForUsage(AIUsageType.ASSIGNMENT_GRADING)).toBe(
      true,
    );
    expect(service.isDisabledForUsage(AIUsageType.GRADING_VALIDATION)).toBe(
      true,
    );
    expect(
      service.isDisabledForUsage(AIUsageType.LIVE_RECORDING_FEEDBACK),
    ).toBe(true);
    expect(service.isDisabledForUsage(AIUsageType.TRANSLATION)).toBe(false);
    expect(service.isDisabledForUsage(AIUsageType.QUESTION_GENERATION)).toBe(
      false,
    );
  });

  it("assertUsageEnabled throws only for disabled components", () => {
    process.env.AI_AUTHORING_DISABLED = "true";
    const service = new AiFeatureFlagsService(makePrisma(), makeLogger());
    expect(() => service.assertUsageEnabled(AIUsageType.TRANSLATION)).toThrow(
      AiTemporarilyDisabledException,
    );
    expect(() =>
      service.assertUsageEnabled(AIUsageType.ASSIGNMENT_GRADING),
    ).not.toThrow();
  });

  // ---- DB-backed behavior (Phase 1) ----

  it("seeds the DB only for explicitly-set env vars on init", async () => {
    process.env.AI_FEATURES_DISABLED = "true";
    const prisma = makePrisma();
    const service = new AiFeatureFlagsService(prisma, makeLogger());
    await service.onModuleInit();
    service.onModuleDestroy();

    expect(prisma.aiFeatureFlag.upsert).toHaveBeenCalledTimes(1);
    expect(prisma.aiFeatureFlag.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { component: AiFeatureComponent.ALL },
        create: expect.objectContaining({
          component: AiFeatureComponent.ALL,
          enabled: false,
        }),
      }),
    );
  });

  it("lets a DB row override env at runtime (admin re-enable)", async () => {
    process.env.AI_GRADING_DISABLED = "true";
    // DB says grading is enabled again (an admin flipped it back on).
    const prisma = makePrisma([{ component: "GRADING", enabled: true }]);
    const service = new AiFeatureFlagsService(prisma, makeLogger());
    // Before init, the env-derived snapshot has grading disabled.
    expect(service.isDisabled(AiFeatureComponent.GRADING)).toBe(true);
    await service.onModuleInit();
    service.onModuleDestroy();
    // After loading the DB snapshot, the admin value wins.
    expect(service.isDisabled(AiFeatureComponent.GRADING)).toBe(false);
  });

  it("setEnabled upserts and updates the live snapshot", async () => {
    const prisma = makePrisma();
    const service = new AiFeatureFlagsService(prisma, makeLogger());
    // After the write, findMany reflects the new row.
    prisma.aiFeatureFlag.findMany.mockResolvedValue([
      {
        component: "CHAT",
        enabled: false,
        updatedBy: "admin@x",
        updatedAt: new Date(),
      },
    ]);

    await service.setEnabled(AiFeatureComponent.CHAT, false, "admin@x");

    expect(prisma.aiFeatureFlag.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { component: AiFeatureComponent.CHAT },
        update: { enabled: false, updatedBy: "admin@x" },
      }),
    );
    expect(service.isDisabled(AiFeatureComponent.CHAT)).toBe(true);
  });
});
