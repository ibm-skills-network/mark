import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PrismaClient, EmailSuppressionReason } from "@prisma/client";
import { PrismaService } from "../../database/prisma.service";
import { EmailSuppressionService } from "./email-suppression.service";
import { parseBounce, DAY_MS } from "./email-bounce-source";

// Dedicated local/test database only. Each run uses and removes its own schema.
const databaseUrl = process.env.EMAIL_BOUNCE_TEST_DATABASE_URL;
(databaseUrl ? describe : describe.skip)(
  "bounce ingestion (PostgreSQL)",
  () => {
    const schema = `bounce_test_${randomUUID().replaceAll("-", "")}`;
    const url = new URL(databaseUrl || "postgresql://localhost/test");
    url.searchParams.set("schema", schema);
    const prisma = new PrismaClient({
      datasources: { db: { url: url.toString() } },
    });
    const service = new EmailSuppressionService(
      prisma as unknown as PrismaService,
    );
    const environment = { ...process.env };
    const source = "test-instance/test-config";
    const event = (
      email: string,
      reason = "UNKNOWN_USER",
      timestamp = new Date(Date.now() - 60_000),
      scope = source,
    ) =>
      parseBounce(
        {
          email_address: email,
          error_message: reason,
          timestamp: timestamp.toISOString(),
          subject: "Test grade",
        },
        scope,
      );

    beforeAll(async () => {
      await prisma.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
      for (const migration of [
        "20261005120000_add_email_suppression",
        "20261028120000_email_bounce_ingestion",
        "20261028230000_email_delivery_recovery",
      ]) {
        const sql = readFileSync(
          resolve(
            __dirname,
            "../../../prisma/migrations",
            migration,
            "migration.sql",
          ),
          "utf8",
        );
        for (const statement of sql.split(";").filter((part) => part.trim()))
          await prisma.$executeRawUnsafe(statement);
      }
      process.env.EMAIL_BOUNCE_INSTANCE_ID = "test-instance";
      process.env.EMAIL_BOUNCE_SMTP_CONFIG_ID = "test-config";
    });
    beforeEach(async () => {
      await prisma.emailBounceEvent.deleteMany();
      await prisma.emailSuppression.deleteMany();
      await prisma.emailSuppressionRelease.deleteMany();
      await prisma.emailDeliveryHold.deleteMany();
      await prisma.emailBouncePollState.deleteMany();
    });
    afterAll(async () => {
      await prisma.$executeRawUnsafe(`DROP SCHEMA "${schema}" CASCADE`);
      await prisma.$disconnect();
      process.env = environment;
    });

    it("suppresses an invalid mailbox once, including concurrent replay", async () => {
      const bounce = event("Gone@Example.com");
      await Promise.all([
        service.recordBounce(bounce),
        service.recordBounce(bounce),
      ]);
      expect(await prisma.emailBounceEvent.count()).toBe(1);
      expect(await prisma.emailSuppression.count()).toBe(1);
      expect(await service.isSuppressed("GONE@example.com")).toBe(true);
      expect(await prisma.emailSuppression.findFirst()).toMatchObject({
        reason: "HARD_BOUNCE",
        detail: expect.stringContaining("UNKNOWN_USER"),
      });
    });

    it("rolls back the event if suppression fails so a later poll can retry", async () => {
      await prisma.$executeRawUnsafe(
        `ALTER TABLE "EmailSuppression" ADD CONSTRAINT "test_failure" CHECK (email <> 'retry@example.com')`,
      );
      const bounce = event("retry@example.com");
      await expect(service.recordBounce(bounce)).rejects.toThrow();
      expect(await prisma.emailBounceEvent.count()).toBe(0);
      await prisma.$executeRawUnsafe(
        `ALTER TABLE "EmailSuppression" DROP CONSTRAINT "test_failure"`,
      );
      await service.recordBounce(bounce);
      expect(await service.isSuppressed(bounce.email)).toBe(true);
    });

    it("temporarily holds repeated policy or unknown errors without permanent suppression", async () => {
      for (const reason of [
        "MESSAGE_REFUSED",
        "UNKNOWN_ERROR",
        "new provider reason",
      ]) {
        await service.recordBounce(event("valid@example.com", reason));
        await service.recordBounce(
          event("valid@example.com", reason, new Date(Date.now() - 120_000)),
        );
      }
      expect(await prisma.emailSuppression.count()).toBe(0);
      expect(
        await prisma.emailDeliveryHold.findUnique({
          where: { email: "valid@example.com" },
        }),
      ).toMatchObject({ stage: 1 });
    });

    it("keeps admin releases across replay and late old bounces, but handles a new invalid-mailbox bounce", async () => {
      const bounce = event("gone@example.com");
      await service.recordBounce(bounce);
      const suppression = await prisma.emailSuppression.findFirstOrThrow();
      expect(await service.remove(suppression.id, "admin@example.com")).toBe(
        true,
      );
      await service.recordBounce(bounce);
      await service.recordBounce(
        event(bounce.email, "UNKNOWN_USER", new Date(Date.now() - 120_000)),
      );
      expect(await service.isSuppressed(bounce.email)).toBe(false);
      const release = await prisma.emailSuppressionRelease.findUniqueOrThrow({
        where: { email: bounce.email },
      });
      await service.recordBounce(
        event(
          bounce.email,
          "UNKNOWN_USER",
          new Date(release.releasedAt.getTime() + 1000),
        ),
      );
      expect(await service.isSuppressed(bounce.email)).toBe(true);
    });

    it("serializes a release with ingestion of an older report", async () => {
      await service.suppress(
        "gone@example.com",
        EmailSuppressionReason.MANUAL,
        "test",
        "admin",
      );
      const suppression = await prisma.emailSuppression.findFirstOrThrow();
      await Promise.all([
        service.recordBounce(event(suppression.email)),
        service.remove(suppression.id, "admin"),
      ]);
      expect(await service.isSuppressed(suppression.email)).toBe(false);
    });

    it("preserves a pre-existing complaint reason", async () => {
      await service.suppress(
        "gone@example.com",
        EmailSuppressionReason.COMPLAINT,
        "Recipient complaint",
        "admin",
      );
      await service.recordBounce(event("gone@example.com"));
      expect(await prisma.emailSuppression.findFirst()).toMatchObject({
        reason: "COMPLAINT",
        detail: "Recipient complaint",
      });
    });

    it("warns on distinct recipients within seven days and only the configured source", async () => {
      const now = new Date();
      for (let index = 0; index < 3; index++) {
        await service.recordBounce(
          event(
            "one@example.com",
            "MESSAGE_REFUSED",
            new Date(now.getTime() - (index + 1) * 1000),
          ),
        );
        await service.recordBounce(
          event(
            `${index}@old.example`,
            "MESSAGE_REFUSED",
            new Date(now.getTime() - 8 * DAY_MS),
          ),
        );
        await service.recordBounce(
          event(
            `${index}@other.example`,
            "MESSAGE_REFUSED",
            now,
            "other/config",
          ),
        );
        await service.recordBounce(
          event(`${index}@invalid.example`, "UNKNOWN_USER", now),
        );
      }
      expect((await service.bounceHealth()).domains).toEqual([]);
      await service.recordBounce(event("two@example.com", "UNKNOWN_ERROR"));
      await service.recordBounce(event("three@example.com", "MESSAGE_REFUSED"));
      expect((await service.bounceHealth()).domains).toEqual([
        {
          domain: "example.com",
          recipients: 3,
          lastBounceAt: expect.any(Date),
        },
      ]);
    });

    const holdFor = (email = "recover@example.com") =>
      prisma.emailDeliveryHold.findUniqueOrThrow({ where: { email } });
    const createHold = async (email = "recover@example.com") => {
      await service.recordBounce(
        event(email, "MESSAGE_REFUSED", new Date(Date.now() - 2 * DAY_MS)),
      );
      await service.recordBounce(
        event(email, "UNKNOWN_ERROR", new Date(Date.now() - 2 * DAY_MS + 1000)),
      );
      return holdFor(email);
    };
    const beginTrial = async (email = "recover@example.com") => {
      await prisma.emailDeliveryHold.update({
        where: { email },
        data: { holdUntil: new Date(Date.now() - 1000) },
      });
      await prisma.emailBouncePollState.upsert({
        where: { source },
        create: { source, lastSuccessAt: new Date() },
        update: { lastSuccessAt: new Date(), lastError: null },
      });
      const permit = await service.acquireRecoveryPermit(email);
      expect(permit.allowed).toBe(true);
      if (!permit.allowed || !("probeToken" in permit) || !permit.probeToken)
        throw new Error("Expected a trial reservation");
      return permit.probeToken;
    };

    it("requires two unique recent failures and does not extend holds for replay", async () => {
      const first = event("recover@example.com", "MESSAGE_REFUSED");
      await service.recordBounce(first);
      await service.recordBounce(first);
      await service.recordBounce(
        event(first.email, "UNKNOWN_ERROR", new Date(Date.now() - 8 * DAY_MS)),
      );
      expect(await prisma.emailDeliveryHold.count()).toBe(0);
      await service.recordBounce(
        event(first.email, "UNKNOWN_ERROR", new Date(Date.now() - 120_000)),
      );
      const hold = await holdFor();
      expect(hold.stage).toBe(1);
      expect(hold.holdUntil.getTime() - Date.now()).toBeGreaterThan(
        DAY_MS - 1000,
      );
      await service.recordBounce(first);
      expect((await holdFor()).holdUntil).toEqual(hold.holdUntil);
      expect(await service.acquireRecoveryPermit(first.email)).toMatchObject({
        allowed: false,
        reason: "temporary_hold",
      });
    });

    it("admits exactly one trial across concurrent senders", async () => {
      await createHold();
      await prisma.emailDeliveryHold.update({
        where: { email: "recover@example.com" },
        data: { holdUntil: new Date(Date.now() - 1000) },
      });
      await prisma.emailBouncePollState.create({
        data: { source, lastSuccessAt: new Date() },
      });
      const permits = await Promise.all(
        Array.from({ length: 8 }, () =>
          service.acquireRecoveryPermit(" RECOVER@EXAMPLE.COM "),
        ),
      );
      expect(permits.filter((permit) => permit.allowed)).toHaveLength(1);
      expect(permits.filter((permit) => !permit.allowed)).toHaveLength(7);
    });

    it("applies the new policy to previously ingested history without duplicating events", async () => {
      const history = [
        event("recover@example.com", "MESSAGE_REFUSED"),
        event("recover@example.com", "UNKNOWN_ERROR"),
      ];
      await prisma.emailBounceEvent.createMany({ data: history });
      await service.recordBounce(history[0]);
      const hold = await holdFor();
      await service.recordBounce(history[1]);
      expect(await prisma.emailBounceEvent.count()).toBe(2);
      expect((await holdFor()).holdUntil).toEqual(hold.holdUntil);
    });

    it("does not admit a trial when polling is stale or failing", async () => {
      await createHold();
      await prisma.emailDeliveryHold.update({
        where: { email: "recover@example.com" },
        data: { holdUntil: new Date(Date.now() - 1000) },
      });
      expect(
        await service.acquireRecoveryPermit("recover@example.com"),
      ).toMatchObject({ allowed: false, reason: "recovery_unavailable" });
      await prisma.emailBouncePollState.create({
        data: { source, lastSuccessAt: new Date(), lastError: "IBM HTTP 429" },
      });
      expect(
        await service.acquireRecoveryPermit("recover@example.com"),
      ).toMatchObject({ allowed: false, reason: "recovery_unavailable" });
    });

    it("escalates failed trials to three then seven days, not for already-in-flight reports", async () => {
      const original = await createHold();
      await service.recordBounce(event(original.email, "MESSAGE_REFUSED"));
      expect((await holdFor()).holdUntil).toEqual(original.holdUntil);
      for (const stage of [2, 3, 3]) {
        const token = await beginTrial();
        const bounce = event(original.email, "MESSAGE_REFUSED", new Date());
        await service.recordBounce(bounce);
        const hold = await holdFor();
        expect(hold.stage).toBe(stage);
        expect(hold.holdUntil.getTime() - Date.now()).toBeGreaterThan(
          (stage === 2 ? 3 : 7) * DAY_MS - 1000,
        );
        // A delayed SMTP completion from the failed trial cannot undo its hold.
        await service.finishRecoveryProbe(original.email, token, true);
        expect((await holdFor()).probeAcceptedAt).toBeNull();
        await service.recordBounce(bounce);
        expect((await holdFor()).holdUntil).toEqual(hold.holdUntil);
      }
    });

    it("resumes automatically only after observation and a completed sweep, retaining escalation history", async () => {
      const hold = await createHold();
      const token = await beginTrial();
      await service.finishRecoveryProbe(hold.email, token, true);
      await service.recoverAfterSweep(source, new Date());
      expect((await holdFor()).recoveredAt).toBeNull();
      await prisma.emailDeliveryHold.update({
        where: { email: hold.email },
        data: {
          probeStartedAt: new Date(Date.now() - 25 * 60 * 60_000),
          probeAcceptedAt: new Date(Date.now() - 25 * 60 * 60_000),
        },
      });
      expect(await service.acquireRecoveryPermit(hold.email)).toMatchObject({
        allowed: false,
      });
      await service.recoverAfterSweep(source, new Date(Date.now() - 60_000));
      expect(await service.acquireRecoveryPermit(hold.email)).toEqual({
        allowed: true,
      });
      expect((await holdFor()).stage).toBe(1);
      await service.recordBounce(
        event(hold.email, "UNKNOWN_ERROR", new Date()),
      );
      expect((await holdFor()).stage).toBe(2);
    });

    it("recovers abandoned reservations without pretending a message was accepted", async () => {
      const hold = await createHold();
      await beginTrial();
      await prisma.emailDeliveryHold.update({
        where: { email: hold.email },
        data: { probeStartedAt: new Date(Date.now() - 25 * 60 * 60_000) },
      });
      await service.recoverAfterSweep(source, new Date(Date.now() - 60_000));
      expect(await holdFor()).toMatchObject({
        probeStartedAt: null,
        probeAcceptedAt: null,
        recoveredAt: null,
        stage: 1,
      });
      expect(await service.acquireRecoveryPermit(hold.email)).toMatchObject({
        allowed: true,
        probeToken: expect.any(String),
      });
    });

    it("requires a fresh trial when the previous observation is outside provider history", async () => {
      const hold = await createHold();
      await beginTrial();
      await prisma.emailDeliveryHold.update({
        where: { email: hold.email },
        data: {
          probeStartedAt: new Date(Date.now() - 35 * DAY_MS),
          probeAcceptedAt: new Date(Date.now() - 35 * DAY_MS),
        },
      });
      await service.recoverAfterSweep(source, new Date());
      expect(await holdFor()).toMatchObject({
        recoveredAt: null,
        probeStartedAt: null,
        probeAcceptedAt: null,
      });
      expect(await service.acquireRecoveryPermit(hold.email)).toMatchObject({
        allowed: true,
        probeToken: expect.any(String),
      });
    });

    it("does not escalate for a local SMTP failure that has no provider bounce", async () => {
      const hold = await createHold();
      const token = await beginTrial();
      await service.finishRecoveryProbe(hold.email, token, false);
      expect(await holdFor()).toMatchObject({
        stage: 1,
        probeStartedAt: null,
        probeAcceptedAt: null,
        recoveredAt: null,
      });
      expect(await service.acquireRecoveryPermit(hold.email)).toMatchObject({
        allowed: false,
      });
    });

    it("protects admin overrides from old reports while requiring two new failures", async () => {
      const hold = await createHold();
      expect(
        await service.releaseTemporaryHold(hold.email, "admin@example.com"),
      ).toBe(true);
      await service.recordBounce(
        event(hold.email, "UNKNOWN_ERROR", new Date(Date.now() - 60_000)),
      );
      expect(await prisma.emailDeliveryHold.count()).toBe(0);
      const release = await prisma.emailSuppressionRelease.findUniqueOrThrow({
        where: { email: hold.email },
      });
      // Move only the test release cutoff back so subsequent events have a distinct timestamp.
      await prisma.emailSuppressionRelease.update({
        where: { email: hold.email },
        data: { releasedAt: new Date(release.releasedAt.getTime() - 1000) },
      });
      await service.recordBounce(
        event(hold.email, "UNKNOWN_ERROR", new Date()),
      );
      expect(await prisma.emailDeliveryHold.count()).toBe(0);
      await service.recordBounce(
        event(hold.email, "MESSAGE_REFUSED", new Date()),
      );
      expect((await holdFor()).stage).toBe(1);
    });

    it("permanent invalid-mailbox suppression takes precedence over recovery", async () => {
      const hold = await createHold();
      await beginTrial();
      await service.recordBounce(event(hold.email, "UNKNOWN_USER", new Date()));
      expect(await prisma.emailDeliveryHold.count()).toBe(0);
      expect(await service.acquireRecoveryPermit(hold.email)).toMatchObject({
        allowed: false,
        reason: "suppressed",
      });
    });

    it("handles trial bounces reported after a long poller outage", async () => {
      const hold = await createHold();
      await beginTrial();
      await prisma.emailDeliveryHold.update({
        where: { email: hold.email },
        data: {
          lastFailureAt: new Date(Date.now() - 10 * DAY_MS),
          probeStartedAt: new Date(Date.now() - 9 * DAY_MS),
          probeAcceptedAt: new Date(Date.now() - 9 * DAY_MS),
        },
      });
      await service.recordBounce(
        event(hold.email, "MESSAGE_REFUSED", new Date(Date.now() - 8 * DAY_MS)),
      );
      await service.recoverAfterSweep(source, new Date());
      expect(await holdFor()).toMatchObject({ stage: 2, recoveredAt: null });
    });

    it("ages escalation history out after thirty quiet days without calling it delivered", async () => {
      const hold = await createHold();
      await prisma.emailDeliveryHold.update({
        where: { email: hold.email },
        data: {
          stage: 3,
          recoveredAt: new Date(Date.now() - 31 * DAY_MS),
          lastFailureAt: new Date(Date.now() - 35 * DAY_MS),
        },
      });
      // Remove the setup's recent events; the retained hold represents an old incident.
      await prisma.emailBounceEvent.deleteMany();
      await service.recordBounce(event(hold.email, "MESSAGE_REFUSED"));
      expect(await service.acquireRecoveryPermit(hold.email)).toEqual({
        allowed: true,
      });
      await service.recordBounce(event(hold.email, "UNKNOWN_ERROR"));
      expect(await holdFor()).toMatchObject({ stage: 1, recoveredAt: null });
    });

    it("raises a sender-level warning only for widespread recent failures", async () => {
      for (let index = 0; index < 10; index++) {
        await service.recordBounce(
          event(`${index}@domain${index % 3}.example`, "MESSAGE_REFUSED"),
        );
      }
      expect((await service.bounceHealth()).senderWarning).toEqual({
        active: true,
        domains: 3,
        recipients: 10,
      });
    });
  },
);
