import { PrismaClient } from "@prisma/client";

export type TestPrisma = PrismaClient<{
  log: [{ emit: "event"; level: "query" }];
}>;

export function createTestPrisma(url: string): TestPrisma {
  return new PrismaClient({
    log: [{ emit: "event", level: "query" }],
    datasources: { db: { url } },
  });
}

export async function withTestDb(
  fn: (prisma: TestPrisma) => Promise<void>,
): Promise<void> {
  const url = process.env.DATABASE_URL_TEST;
  if (!url) {
    throw new Error("DATABASE_URL_TEST is not set");
  }
  const prisma = createTestPrisma(url);
  try {
    await fn(prisma);
  } finally {
    await prisma.$disconnect();
  }
}

// Prisma's $on has no unsubscribe, so each client gets one listener that
// writes to this shared counter; expectQueries calls must run sequentially.
let queryCount = 0;
const subscribed = new WeakSet<TestPrisma>();

export async function expectQueries<T>(
  prisma: TestPrisma,
  n: number,
  fn: () => Promise<T>,
): Promise<T> {
  if (!subscribed.has(prisma)) {
    subscribed.add(prisma);
    prisma.$on("query", () => {
      queryCount += 1;
    });
  }
  queryCount = 0;
  const result = await fn();
  if (queryCount > n) {
    throw new Error(`Expected at most ${n} queries, saw ${queryCount}`);
  }
  return result;
}
