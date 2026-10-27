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
  };
}
