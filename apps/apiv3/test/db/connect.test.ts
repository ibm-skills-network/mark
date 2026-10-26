import { describe, expect, it } from "vitest";
import { createPrisma } from "../../src/shared/prisma.js";
import { expectQueries, withTestDb } from "../helpers/db.js";

describe.skipIf(!process.env.DATABASE_URL_TEST)("scratch database", () => {
  it("connects through createPrisma", async () => {
    const prisma = createPrisma({
      databaseUrl: process.env.DATABASE_URL_TEST ?? "",
    });
    try {
      const rows = await prisma.$queryRaw`SELECT 1 AS one`;
      expect(rows).toEqual([{ one: 1 }]);
    } finally {
      await prisma.$disconnect();
    }
  });

  it("passes when the query count is within budget", async () => {
    await withTestDb(async (prisma) => {
      await expectQueries(prisma, 1, () => prisma.$queryRaw`SELECT 1`);
    });
  });

  it("fails with the observed count when over budget", async () => {
    await withTestDb(async (prisma) => {
      await expect(
        expectQueries(prisma, 0, () => prisma.$queryRaw`SELECT 1`),
      ).rejects.toThrow("Expected at most 0 queries, saw 1");
    });
  });
});
