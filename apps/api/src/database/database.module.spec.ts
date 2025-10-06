import { Test } from "@nestjs/testing";
import { DatabaseCircuitBreakerService } from "./circuit-breaker/database-circuit-breaker.service";
import { DatabaseModule } from "./database.module";
import { PrismaService } from "./prisma.service";

describe("DatabaseModule", () => {
  const originalDatabaseUrl = process.env.DATABASE_URL;
  const fallbackDatabaseUrl =
    originalDatabaseUrl ?? "postgresql://user:pass@localhost:5432/test"; // pragma: allowlist secret

  beforeAll(() => {
    process.env.DATABASE_URL = fallbackDatabaseUrl;
  });

  afterAll(() => {
    if (originalDatabaseUrl) {
      process.env.DATABASE_URL = originalDatabaseUrl;
    } else {
      delete process.env.DATABASE_URL;
    }
  });

  it("provides PrismaService and DatabaseCircuitBreakerService", async () => {
    const moduleReference = await Test.createTestingModule({
      imports: [DatabaseModule],
    }).compile();

    const prisma = moduleReference.get(PrismaService);
    const circuitBreaker = moduleReference.get(DatabaseCircuitBreakerService);

    expect(prisma).toBeInstanceOf(PrismaService);
    expect(circuitBreaker).toBeInstanceOf(DatabaseCircuitBreakerService);
  });
});
