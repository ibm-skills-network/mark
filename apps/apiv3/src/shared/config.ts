import { z } from "zod";

export type Config = {
  serviceName: string;
  port: number;
  logLevel: "debug" | "info" | "warn" | "error";
  databaseUrl: string;
  validateResponses: boolean;
  consumeWork: boolean;
  dispatchExternalEffects: boolean;
  workerHealthPort: number;
  aiFeatures: {
    allDisabled: boolean;
    gradingDisabled: boolean;
    chatDisabled: boolean;
    authoringDisabled: boolean;
  };
};

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

const flag = z
  .string()
  .optional()
  .transform((v) => v === "true");

// Legacy idiom (1/true/yes, case-insensitive, trimmed), deliberately wider than the "true"-only flag above.
const aiFlag = z
  .string()
  .optional()
  .transform((v) =>
    ["1", "true", "yes"].includes((v ?? "").toLowerCase().trim()),
  );

const portSchema = (fallback: number) =>
  z
    .string()
    .regex(/^\d+$/, "must be an integer")
    .transform(Number)
    .pipe(z.number().int().min(1).max(65535))
    .optional()
    .transform((v) => v ?? fallback);

const schema = z.object({
  SERVICE_NAME: z.string().min(1).default("mark-v3"),
  PORT: portSchema(3000),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
  DATABASE_URL: z.string().startsWith("postgres"),
  V3_VALIDATE_RESPONSES: flag,
  V3_CONSUME_WORK: flag,
  V3_DISPATCH_EXTERNAL_EFFECTS: flag,
  WORKER_HEALTH_PORT: portSchema(8081),
  AI_FEATURES_DISABLED: aiFlag,
  AI_GRADING_DISABLED: aiFlag,
  AI_CHAT_DISABLED: aiFlag,
  AI_AUTHORING_DISABLED: aiFlag,
});

export function loadConfig(env: NodeJS.ProcessEnv): Config {
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    const reasons = new Map<string, string>();
    for (const issue of parsed.error.issues) {
      const key = String(issue.path[0] ?? "env");
      if (!reasons.has(key)) reasons.set(key, issue.message);
    }
    const listed = [...reasons]
      .map(([key, reason]) => `${key} (${reason})`)
      .join(", ");
    throw new ConfigError(`Invalid configuration: ${listed}`);
  }
  const v = parsed.data;
  return {
    serviceName: v.SERVICE_NAME,
    port: v.PORT,
    logLevel: v.LOG_LEVEL,
    databaseUrl: v.DATABASE_URL,
    validateResponses: v.V3_VALIDATE_RESPONSES,
    consumeWork: v.V3_CONSUME_WORK,
    dispatchExternalEffects: v.V3_DISPATCH_EXTERNAL_EFFECTS,
    workerHealthPort: v.WORKER_HEALTH_PORT,
    aiFeatures: {
      allDisabled: v.AI_FEATURES_DISABLED,
      gradingDisabled: v.AI_GRADING_DISABLED,
      chatDisabled: v.AI_CHAT_DISABLED,
      authoringDisabled: v.AI_AUTHORING_DISABLED,
    },
  };
}
