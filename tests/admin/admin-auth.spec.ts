/**
 * Admin authentication + dashboard (admin area).
 *
 * The admin area uses a SEPARATE auth scheme from the learner/author cookie:
 * an email -> 6-digit code -> session-token flow (apps/api/src/auth/controllers/
 * admin-auth.controller.ts), and admin API calls carry that token in an
 * `x-admin-token` header (not the `authentication` cookie). AUTH_DISABLED does
 * NOT fake an admin session — the admin guard validates the token against the
 * `adminSession` table in the DB.
 *
 * What is DETERMINISTICALLY testable in e2e today (no extra infra):
 *   - /admin with no stored session renders <AdminLogin/> (the email step).
 *   - POST /api/v1/auth/admin/send-code ALWAYS returns 200 with a neutral
 *     message (by design, to avoid leaking the admin allowlist), so the UI's
 *     email -> code step transition works for ANY syntactically valid email.
 *
 * What is NOT obtainable without infra we will not silently add (-> test.fixme):
 *   - A real admin SESSION. Completing verify-code requires BOTH (a) the caller
 *     email to be on the allowlist — `ADMIN_EMAILS` env var, which the e2e stack
 *     (apps/api start:e2e -> ./dev.env) does NOT set — AND (b) the 6-digit code,
 *     which is only emailed / dev-console-logged (AdminEmailService) and has NO
 *     HTTP or DB test seam. The admin guard checks the DB, so injecting a forged
 *     token into localStorage will not pass either. The dashboard-tables and
 *     llm-assignments-save specs therefore stay fixme until that seam exists.
 *
 * Role: admin area. These tests use FRESH browser contexts (no project
 * storageState) because the admin flow does not use the learner/author cookie.
 * The Integrate phase registers an admin Playwright project for this directory.
 */
import { expect, test } from "@playwright/test";
import { getTestEnvironmentConfig } from "../helpers/assignment-helpers";

const config = getTestEnvironmentConfig();

test.describe("Admin - authentication gate", () => {
  test("visiting /admin without a session renders the admin login (email step)", async ({
    browser,
  }) => {
    // Fresh context: no admin session in localStorage, no learner/author cookie.
    const context = await browser.newContext({ baseURL: config.webBaseUrl });
    const page = await context.newPage();
    try {
      await page.goto("/admin");

      // AdminLogin email step: title "Admin Access" + the send-code button.
      await expect(
        page.getByRole("heading", { name: "Admin Access" }),
      ).toBeVisible({ timeout: 20_000 });
      await expect(
        page.getByRole("button", { name: "Send Verification Code" }),
      ).toBeVisible();
      // The dashboard must NOT be reachable without a session.
      await expect(
        page.getByRole("button", { name: "Send Verification Code" }),
      ).toBeEnabled();
    } finally {
      await context.close();
    }
  });

  test("a returnTo-protected admin route redirects to the admin login", async ({
    browser,
  }) => {
    const context = await browser.newContext({ baseURL: config.webBaseUrl });
    const page = await context.newPage();
    try {
      // Deep admin routes are client-guarded; with no session they fall back to
      // the admin login (directly or via an /admin?returnTo= redirect).
      await page.goto("/admin/llm-assignments");
      await expect(
        page.getByRole("heading", { name: "Admin Access" }),
      ).toBeVisible({ timeout: 20_000 });
    } finally {
      await context.close();
    }
  });

  test("submitting an email advances the login to the verification-code step", async ({
    browser,
  }) => {
    const context = await browser.newContext({ baseURL: config.webBaseUrl });
    const page = await context.newPage();
    try {
      await page.goto("/admin");
      await expect(
        page.getByRole("heading", { name: "Admin Access" }),
      ).toBeVisible({ timeout: 20_000 });

      // send-code returns a neutral 200 for any valid email, so the UI advances
      // to the code step regardless of allowlist membership.
      await page.getByPlaceholder("admin@example.com").fill(config.adminEmail);
      await page
        .getByRole("button", { name: "Send Verification Code" })
        .click();

      await expect(
        page.getByRole("heading", { name: "Enter Verification Code" }),
      ).toBeVisible({ timeout: 15_000 });
      // The neutral acknowledgement copy from the server.
      await expect(
        page.getByText(/verification code has been sent/i),
      ).toBeVisible();
    } finally {
      await context.close();
    }
  });

  test("the code step rejects a non-numeric / wrong code without granting access", async ({
    browser,
  }) => {
    const context = await browser.newContext({ baseURL: config.webBaseUrl });
    const page = await context.newPage();
    try {
      await page.goto("/admin");
      await page.getByPlaceholder("admin@example.com").fill(config.adminEmail);
      await page
        .getByRole("button", { name: "Send Verification Code" })
        .click();
      await expect(
        page.getByRole("heading", { name: "Enter Verification Code" }),
      ).toBeVisible({ timeout: 15_000 });

      // A wrong 6-digit code: verify-code returns the generic 400, so the UI
      // shows an error and never reaches the dashboard.
      await page.getByPlaceholder("123456").fill("000000");
      await page.getByRole("button", { name: "Verify Code" }).click();

      await expect(page.getByText("Error")).toBeVisible({ timeout: 15_000 });
      await expect(
        page.getByRole("heading", { name: "Enter Verification Code" }),
      ).toBeVisible();
    } finally {
      await context.close();
    }
  });
});

test.describe("Admin - authenticated dashboard (needs admin-session seam)", () => {
  // The three specs below require a REAL admin session. Obtaining one in e2e
  // needs, together:
  //   1. ADMIN_EMAILS to include a known test email so isAuthorizedEmail() is
  //      true (set it in apps/api dev.env / start:e2e env), AND
  //   2. a way to read the 6-digit verification code that send-code generates —
  //      e.g. a test-only endpoint that returns the latest code for an email,
  //      or direct read of the `adminVerificationCode` Prisma table from the
  //      test (the harness exposes no DB client today).
  // With those, a helper can: POST send-code -> fetch code -> POST verify-code
  // -> writeAdminSessionToStorage({ sessionToken, email, expiresAt }) into the
  // browser context before navigating, unlocking the dashboard.

  test.fixme(
    "login (email -> code -> session) lands on the admin dashboard",
    async () => {
      // TODO: with the ADMIN_EMAILS + code seam above, complete the real flow
      // and assert OptimizedAdminDashboard renders (e.g. a logout control / the
      // reports + feedback tables) instead of the AdminLogin card.
    },
  );

  test.fixme(
    "dashboard data tables (reports / feedback) load for an authenticated admin",
    async () => {
      // TODO: seed at least one report+feedback row, authenticate as admin, then
      // assert the dashboard tables render those rows (GET /api/v1/reports/* with
      // the x-admin-token header succeeds and rows appear).
    },
  );

  test.fixme(
    "llm-assignments: toggling an assignment's LLM setting persists on save",
    async () => {
      // TODO: authenticate as admin, open /admin/llm-assignments, flip a per-
      // assignment LLM toggle, Save (PUT /api/v1/admin/... with x-admin-token),
      // reload, and assert the new value persisted.
    },
  );
});
