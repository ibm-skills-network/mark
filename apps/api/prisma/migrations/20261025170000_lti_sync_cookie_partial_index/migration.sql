-- The retention sweep blanks LtiGradeSync.authCookie in batches selected by
-- age. A row leaves this partial index as soon as its cookie is blanked, so
-- a batch never walks over rows that are already done; without it the last
-- batch of a sweep, and every nightly run after, scans the whole table.
CREATE INDEX "LtiGradeSync_cookie_updatedAt_idx" ON "LtiGradeSync"("updatedAt") WHERE "authCookie" <> '';
