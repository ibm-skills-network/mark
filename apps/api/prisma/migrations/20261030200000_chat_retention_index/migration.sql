-- The nightly retention sweep selects Chat rows by age.
CREATE INDEX "Chat_lastActiveAt_idx" ON "Chat"("lastActiveAt");
