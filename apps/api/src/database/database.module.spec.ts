import { Global, Module } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { WINSTON_MODULE_PROVIDER } from "nest-winston";
import { DatabaseCircuitBreakerService } from "./circuit-breaker/database-circuit-breaker.service";
import { DatabaseModule } from "./database.module";
import { PrismaService } from "./prisma.service";

const mockLogger = {
  child: jest.fn().mockReturnValue({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  }),
};

@Global()
@Module({
  providers: [{ provide: WINSTON_MODULE_PROVIDER, useValue: mockLogger }],
  exports: [WINSTON_MODULE_PROVIDER],
})
class MockWinstonModule {}

describe("DatabaseModule", () => {
  const originalDatabaseUrl = process.env.DATABASE_URL;
  const fallbackDatabaseUrl =
    originalDatabaseUrl ?? "postgresql://user:pass@localhost:5432/test";

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
      imports: [MockWinstonModule, DatabaseModule],
    }).compile();

    const prisma = moduleReference.get(PrismaService);
    const circuitBreaker = moduleReference.get(DatabaseCircuitBreakerService);

    expect(prisma).toBeInstanceOf(PrismaService);
    expect(circuitBreaker).toBeInstanceOf(DatabaseCircuitBreakerService);
  });
});
