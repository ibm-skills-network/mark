import { Writable } from "node:stream";
import {
  Body,
  Controller,
  Get,
  INestApplication,
  Injectable,
  Module,
  Post,
} from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { WinstonModule } from "nest-winston";
import * as winston from "winston";
import { z } from "zod";
import { AuthModule } from "../../../src/auth/auth.module";
import { configureHttpApp } from "../../../src/bootstrap/configure-http-app";
import { CommonModule } from "../../../src/common/common.module";
import { DatabaseCircuitBreakerService } from "../../../src/database/circuit-breaker/database-circuit-breaker.service";
import { DatabaseModule } from "../../../src/database/database.module";
import { PrismaService } from "../../../src/database/prisma.service";
import {
  V3Controller,
  V3Route,
} from "../../../src/v3/core/v3-controller.decorator";
import { V3Error } from "../../../src/v3/core/errors";
import {
  V3Principal,
  UsePrincipal,
} from "../../../src/v3/core/principal.guard";
import type { Principal } from "../../../src/v3/core/principal";
import { INSTANA } from "../../../src/v3/core/tracing";
import { V3Logger } from "../../../src/v3/core/v3-logger";
import { ZodPipe } from "../../../src/v3/core/zod.pipe";
import { V3Module } from "../../../src/v3/v3.module";

export type LogEntry = Record<string, unknown> & {
  level: string;
  message: string;
};

/** Records annotations the way the Instana SDK span handle receives them. */
export class FakeInstana {
  readonly annotations: Array<[string, unknown]> = [];
  constructor(private readonly id: string | null = "trace-abc") {}
  currentSpan() {
    return {
      getTraceId: () => this.id,
      annotate: (path: string, value: unknown) => {
        this.annotations.push([path, value]);
      },
    };
  }
}

// ---- v3 probe routes: exercise the production decorators, pipes and filters.

export const probeBody = z.object({ n: z.number().int() });
export const probeOut = z.object({
  n: z.number(),
  content: z.string(),
  at: z.string(),
});

@Injectable()
export class ProbeService {
  private readonly log: V3Logger;
  constructor(logger: V3Logger) {
    this.log = logger.child("probe");
  }
  work(): void {
    this.log.info("probe.worked", {
      attempt_id: 42,
      cookie: "authentication=secret-cookie",
      password: "hunter2", // pragma: allowlist secret
      note: "x".repeat(2500),
    });
  }
}

@V3Controller("probe")
export class ProbeController {
  constructor(private readonly service: ProbeService) {}

  @Post("echo")
  @V3Route({ response: probeOut })
  echo(@Body(new ZodPipe(probeBody)) body: z.infer<typeof probeBody>) {
    return {
      extra: "dropped",
      at: "2026-01-01T00:00:00.000Z",
      content: "hello",
      n: body.n,
    };
  }

  @Get("boom")
  @V3Route({ response: z.object({}) })
  boom(): Record<string, never> {
    throw new Error("connect failed: password=hunter2 host=db.internal"); // pragma: allowlist secret
  }

  @Get("forbidden")
  @V3Route({ response: z.object({}) })
  forbidden(): Record<string, never> {
    throw V3Error.forbidden("not_owner");
  }

  @Get("contract")
  @V3Route({ response: probeOut })
  contract(): unknown {
    return JSON.parse('{"n":"not-a-number","content":"c","at":"a"}');
  }

  @Get("whoami")
  @UsePrincipal()
  @V3Route({ response: z.object({ userId: z.string(), role: z.string() }) })
  whoami(@V3Principal() principal: Principal) {
    this.service.work();
    return { userId: principal.userId, role: principal.role };
  }
}

@Module({ controllers: [ProbeController], providers: [ProbeService] })
export class ProbeModule {}

// ---- a legacy-style route, to prove legacy globals still apply outside v3.

@Controller({ path: "legacy-probe", version: "1" })
export class LegacyProbeController {
  @Post()
  post(@Body() body: unknown) {
    return {
      content: "hello",
      at: new Date("2026-01-01T00:00:00.000Z"),
      size: JSON.stringify(body).length,
    };
  }
}

@Module({ controllers: [LegacyProbeController] })
export class LegacyProbeModule {}

export type V3TestApp = {
  app: INestApplication;
  logs: LogEntry[];
  instana: FakeInstana;
  close: () => Promise<void>;
};

/**
 * Builds mark-api's HTTP stack (configureHttpApp + the real global modules)
 * with the v3 module and the probes. Prisma and the database circuit breaker
 * are stubbed unless `overrides` replaces them.
 */
export async function createV3TestApp(
  options: {
    env?: Record<string, string | undefined>;
    instana?: FakeInstana | null;
    extraV3Modules?: Array<new () => unknown>;
    /** Replaces providers after the defaults (e.g. a real PrismaClient). */
    overrides?: Array<{ provide: unknown; useValue: unknown }>;
  } = {},
): Promise<V3TestApp> {
  const saved: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(options.env ?? {})) {
    saved[key] = process.env[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }

  const logs: LogEntry[] = [];
  const sink = new Writable({
    write(chunk: Buffer, _encoding, done) {
      for (const line of chunk.toString().split("\n")) {
        if (line.trim()) logs.push(JSON.parse(line) as LogEntry);
      }
      done();
    },
  });
  const instana =
    options.instana === undefined ? new FakeInstana() : options.instana;

  try {
    let builder = Test.createTestingModule({
      imports: [
        WinstonModule.forRoot({
          level: "debug",
          format: winston.format.json(),
          transports: [new winston.transports.Stream({ stream: sink })],
        }),
        CommonModule,
        AuthModule,
        DatabaseModule,
        V3Module,
        ProbeModule,
        LegacyProbeModule,
        ...(options.extraV3Modules ?? []),
      ],
    })
      .overrideProvider(PrismaService)
      .useValue({})
      .overrideProvider(DatabaseCircuitBreakerService)
      .useValue({ getStats: () => ({}) })
      .overrideProvider(INSTANA)
      .useValue(instana);
    for (const { provide, useValue } of options.overrides ?? []) {
      builder = builder.overrideProvider(provide).useValue(useValue);
    }
    const moduleRef = await builder.compile();

    const app = moduleRef.createNestApplication();
    configureHttpApp(app);
    await app.init();
    // Listen up front: supertest would otherwise listen and close per request,
    // resetting concurrent requests that have not been sent yet.
    await app.listen(0, "127.0.0.1");
    return {
      app,
      logs,
      instana: instana ?? new FakeInstana(null),
      close: () => app.close(),
    };
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

/** The gateway's header escaping (apps/api-gateway asciiJson). */
export function asciiJson(value: unknown): string {
  return JSON.stringify(value).replaceAll(
    /[\u007F-￿]/g,
    (char) => `\\u${(char.codePointAt(0) ?? 0).toString(16).padStart(4, "0")}`,
  );
}

export const learner = {
  userId: "a@b.co",
  role: "learner",
  groupId: "g",
  assignmentId: 7,
};
