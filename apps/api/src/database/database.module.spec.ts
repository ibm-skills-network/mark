import { Test } from '@nestjs/testing';
import { DatabaseModule } from './database.module';
import { PrismaService } from './prisma.service';
import { DatabaseCircuitBreakerService } from './circuit-breaker/database-circuit-breaker.service';

describe('DatabaseModule', () => {
  const originalDatabaseUrl = process.env.DATABASE_URL;
  const fallbackDatabaseUrl =
    originalDatabaseUrl ?? 'postgresql://user:pass@localhost:5432/test';

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

  it('provides PrismaService and DatabaseCircuitBreakerService', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [DatabaseModule],
    }).compile();

    const prisma = moduleRef.get(PrismaService);
    const circuitBreaker = moduleRef.get(DatabaseCircuitBreakerService);

    expect(prisma).toBeInstanceOf(PrismaService);
    expect(circuitBreaker).toBeInstanceOf(DatabaseCircuitBreakerService);
  });
});
