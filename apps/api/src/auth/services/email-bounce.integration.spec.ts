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

    it("does not suppress repeated policy or unknown errors", async () => {
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
  },
);
