-- The nightly retention sweep selects LtiGradeSync rows by age.
CREATE INDEX "LtiGradeSync_updatedAt_idx" ON "LtiGradeSync"("updatedAt");

-- LZ4 TOAST compression was planned here but the managed PostgreSQL build
-- is compiled without lz4 ("compression method lz4 not supported"), so the
-- columns stay on pglz.
