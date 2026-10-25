import { Inject, Injectable } from "@nestjs/common";
import { WINSTON_MODULE_PROVIDER } from "nest-winston";
import { Logger } from "winston";

export const RUST_JOB_FAMILIES = [
  "translations",
  "publish",
  "grading-standard",
  "grading-heavy",
] as const;

export type RustJobFamily = (typeof RUST_JOB_FAMILIES)[number];

/** Operation kinds each family owns; a kind belongs to exactly one family. */
export const FAMILY_KINDS: Record<RustJobFamily, readonly string[]> = {
  translations: [
    "translate.question",
    "translate.variant",
    "translate.meta",
    "translate.retry-failed",
    "admin.fix-missing",
    "admin.sweep-missing",
  ],
  publish: ["assignment.publish", "assignment.generate-questions"],
  "grading-standard": ["grading.standard"],
  "grading-heavy": ["grading.heavy"],
};

const FAMILY_BY_KIND: ReadonlyMap<string, RustJobFamily> = new Map(
  RUST_JOB_FAMILIES.flatMap((family) =>
    FAMILY_KINDS[family].map((kind) => [kind, family] as const),
  ),
);

export function isKnownOperationKind(kind: string): boolean {
  return FAMILY_BY_KIND.has(kind);
}

function isRustJobFamily(name: string): name is RustJobFamily {
  return (RUST_JOB_FAMILIES as readonly string[]).includes(name);
}

/**
 * Parses MARK_RUST_JOBS. Throws on an unknown family so a typo fails the boot
 * instead of silently leaving the family on the TypeScript path.
 */
export function parseRustJobs(
  environment: string | undefined,
): Set<RustJobFamily> {
  const families = new Set<RustJobFamily>();
  if (!environment) return families;
  for (const raw of environment.split(",")) {
    const name = raw.trim();
    if (!name) continue;
    if (!isRustJobFamily(name)) {
      throw new Error(
        `MARK_RUST_JOBS: unknown job family "${name}"; expected one of ${RUST_JOB_FAMILIES.join(", ")}`,
      );
    }
    families.add(name);
  }
  return families;
}

@Injectable()
export class RustJobsConfig {
  private readonly families: ReadonlySet<RustJobFamily>;

  constructor(@Inject(WINSTON_MODULE_PROVIDER) parentLogger: Logger) {
    const logger = parentLogger.child({ context: RustJobsConfig.name });
    try {
      this.families = parseRustJobs(process.env.MARK_RUST_JOBS);
    } catch (error) {
      logger.error("rust-jobs.config.invalid", {
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      });
      throw error;
    }
    logger.info("rust-jobs.config.loaded", {
      families: [...this.families],
    });
  }

  /** Whether operations of this kind are produced for the Rust worker. */
  isOnRust(kind: string): boolean {
    const family = FAMILY_BY_KIND.get(kind);
    return family !== undefined && this.families.has(family);
  }
}
