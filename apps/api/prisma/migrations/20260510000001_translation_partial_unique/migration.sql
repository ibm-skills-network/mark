-- Close the SELECT-then-INSERT race window for Translation rows.
-- Postgres' nullable variantId defeats a single multi-column @@unique constraint
-- (NULL is never equal to NULL in a UNIQUE comparison), so we use two partial
-- unique indexes instead. This is the orthodox Postgres workaround.
--
-- The Translation table is question-scoped (questionId, variantId). Assignment
-- scope is implied through the Question.assignmentId foreign key with cascade,
-- so there is no assignmentId column on Translation itself.

-- Step 1: Pre-condition assertion. Fail the migration if duplicates exist
-- so the operator runs the dedupe runbook (scripts/dedupe-translation-rows.ts)
-- before retrying. This prevents partial-index creation from silently dropping
-- rows or failing in the middle.
DO $$
DECLARE
  duplicate_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO duplicate_count FROM (
    SELECT "questionId", "languageCode", "variantId"
    FROM "Translation"
    GROUP BY "questionId", "languageCode", "variantId"
    HAVING COUNT(*) > 1
  ) dupes;

  IF duplicate_count > 0 THEN
    RAISE EXCEPTION 'Translation table has % duplicate (questionId, languageCode, variantId) tuples. Run scripts/dedupe-translation-rows.ts before applying this migration.', duplicate_count;
  END IF;
END $$;

-- Step 2: Partial unique index for the (variantId IS NULL) case — covers
-- per-question translations that are not variant-specific.
CREATE UNIQUE INDEX "Translation_question_lang_unique_no_variant"
  ON "Translation"("questionId", "languageCode")
  WHERE "variantId" IS NULL;

-- Step 3: Partial unique index for the (variantId IS NOT NULL) case — covers
-- per-variant translations.
CREATE UNIQUE INDEX "Translation_question_lang_variant_unique"
  ON "Translation"("questionId", "variantId", "languageCode")
  WHERE "variantId" IS NOT NULL;
