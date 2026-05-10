#!/usr/bin/env tsx
/**
 * Dedupe Translation rows before applying the partial-unique-index migration.
 *
 * Usage:
 *   tsx scripts/dedupe-translation-rows.ts --dry-run
 *   tsx scripts/dedupe-translation-rows.ts
 *
 * For each (questionId, languageCode, variantId) group with count > 1, keeps
 * the row with the largest id and deletes the others. Translation rows are
 * question-scoped (no assignmentId column); assignment-scope is implied by
 * the Question.assignmentId foreign key.
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const dryRun = process.argv.includes("--dry-run");

interface DupeGroup {
  questionId: number | null;
  languageCode: string;
  variantId: number | null;
  ids: number[];
}

async function findDuplicateGroups(): Promise<DupeGroup[]> {
  // Use raw SQL — Prisma's groupBy doesn't return the row IDs we need to keep/delete.
  const rows = await prisma.$queryRawUnsafe<DupeGroup[]>(`
    SELECT "questionId", "languageCode", "variantId",
           array_agg(id ORDER BY id DESC) AS ids
    FROM "Translation"
    GROUP BY "questionId", "languageCode", "variantId"
    HAVING COUNT(*) > 1;
  `);
  return rows;
}

async function main(): Promise<void> {
  const groups = await findDuplicateGroups();
  if (groups.length === 0) {
    console.log(
      "No duplicate Translation rows found. Migration is safe to apply.",
    );
    return;
  }

  const totalToDelete = groups.reduce((acc, g) => acc + (g.ids.length - 1), 0);
  console.log(
    `Found ${groups.length} duplicate groups; ${totalToDelete} rows would be deleted (keeping the largest id per group).`,
  );

  if (dryRun) {
    console.log("--dry-run set; no DELETE issued.");
    return;
  }

  let deletedCount = 0;
  for (const g of groups) {
    // ids array is sorted DESC; first element is kept, rest deleted.
    const [, ...idsToDelete] = g.ids;
    if (idsToDelete.length === 0) continue;
    const result = await prisma.translation.deleteMany({
      where: { id: { in: idsToDelete } },
    });
    deletedCount += result.count;
  }
  console.log(`Deleted ${deletedCount} duplicate rows.`);
}

main()
  .catch((err: unknown) => {
    console.error("Dedupe script failed:", err);
    process.exit(1);
  })
  .finally(() => {
    void prisma.$disconnect();
  });
