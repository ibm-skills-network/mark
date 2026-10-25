import { Logger } from "winston";
import {
  FAMILY_KINDS,
  isKnownOperationKind,
  parseRustJobs,
  RUST_JOB_FAMILIES,
  RustJobsConfig,
} from "./rust-jobs.config";

const makeLogger = () => {
  const child = { info: jest.fn(), warn: jest.fn(), error: jest.fn() };
  return { logger: { child: () => child } as unknown as Logger, child };
};

describe("parseRustJobs", () => {
  it.each([undefined, "", " ", " , ,"])("treats %p as no families", (env) => {
    expect(parseRustJobs(env)).toEqual(new Set());
  });

  it("parses a csv with whitespace and duplicates", () => {
    expect(parseRustJobs(" translations ,publish,translations,")).toEqual(
      new Set(["translations", "publish"]),
    );
  });

  it("accepts every family", () => {
    expect(parseRustJobs(RUST_JOB_FAMILIES.join(","))).toEqual(
      new Set(RUST_JOB_FAMILIES),
    );
  });

  it("throws on an unknown family and names the valid ones", () => {
    expect(() => parseRustJobs("translations,grading")).toThrow(
      'MARK_RUST_JOBS: unknown job family "grading"; expected one of translations, publish, grading-standard, grading-heavy',
    );
  });

  it("is case-sensitive", () => {
    expect(() => parseRustJobs("Publish")).toThrow("unknown job family");
  });
});

describe("FAMILY_KINDS", () => {
  it("maps every kind to exactly one family", () => {
    const kinds = RUST_JOB_FAMILIES.flatMap((family) => FAMILY_KINDS[family]);
    expect(new Set(kinds).size).toBe(kinds.length);
    expect(kinds).toEqual([
      "translate.question",
      "translate.variant",
      "translate.meta",
      "translate.retry-failed",
      "admin.fix-missing",
      "admin.sweep-missing",
      "assignment.publish",
      "assignment.generate-questions",
      "grading.standard",
      "grading.heavy",
    ]);
    expect(kinds.every((kind) => isKnownOperationKind(kind))).toBe(true);
    expect(isKnownOperationKind("grading")).toBe(false);
  });
});

describe("RustJobsConfig", () => {
  const saved = process.env.MARK_RUST_JOBS;

  afterEach(() => {
    if (saved === undefined) delete process.env.MARK_RUST_JOBS;
    else process.env.MARK_RUST_JOBS = saved;
  });

  it("keeps everything on TypeScript when unset", () => {
    delete process.env.MARK_RUST_JOBS;
    const config = new RustJobsConfig(makeLogger().logger);
    for (const family of RUST_JOB_FAMILIES) {
      for (const kind of FAMILY_KINDS[family]) {
        expect(config.isOnRust(kind)).toBe(false);
      }
    }
  });

  it("routes only the kinds of enabled families", () => {
    process.env.MARK_RUST_JOBS = "translations,grading-heavy";
    const { logger, child } = makeLogger();
    const config = new RustJobsConfig(logger);
    expect(config.isOnRust("translate.meta")).toBe(true);
    expect(config.isOnRust("admin.sweep-missing")).toBe(true);
    expect(config.isOnRust("grading.heavy")).toBe(true);
    expect(config.isOnRust("grading.standard")).toBe(false);
    expect(config.isOnRust("assignment.publish")).toBe(false);
    expect(config.isOnRust("unknown.kind")).toBe(false);
    expect(child.info).toHaveBeenCalledWith("rust-jobs.config.loaded", {
      families: ["translations", "grading-heavy"],
    });
  });

  it("reads the env once at construction", () => {
    process.env.MARK_RUST_JOBS = "publish";
    const config = new RustJobsConfig(makeLogger().logger);
    process.env.MARK_RUST_JOBS = "";
    expect(config.isOnRust("assignment.publish")).toBe(true);
  });

  it("fails construction on an unknown family and logs it", () => {
    process.env.MARK_RUST_JOBS = "nope";
    const { logger, child } = makeLogger();
    expect(() => new RustJobsConfig(logger)).toThrow("unknown job family");
    expect(child.error).toHaveBeenCalledWith(
      "rust-jobs.config.invalid",
      expect.objectContaining({ error: expect.stringContaining("nope") }),
    );
  });
});
