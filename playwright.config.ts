import path from "node:path";
import { defineConfig, devices } from "@playwright/test";
import { getTestEnvironmentConfig } from "./tests/helpers/assignment-helpers";

const testEnvironment = getTestEnvironmentConfig();

export default defineConfig({
  testDir: "./tests",

  testIgnore: [
    "apps/api/**",
    "apps/api-gateway/**",
    "**/__tests__/**",
    "tests/examples/**",
  ],

  fullyParallel: !process.env.CI,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  // tests share a single assignment — per-worker fixtures needed before re-enabling parallelism
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? [["github"], ["html"], ["list"]] : "html",
  use: {
    baseURL: testEnvironment.webBaseUrl,
    trace: "on-first-retry",
  },

  projects: [
    {
      name: "setup",
      testMatch: /setup\/.*\.setup\.ts/,
    },
    ...[
      {
        browserName: "chromium",
        device: devices["Desktop Chrome"],
      },
      {
        browserName: "firefox",
        device: devices["Desktop Firefox"],
      },
      {
        browserName: "webkit",
        device: devices["Desktop Safari"],
      },
    ].flatMap(({ browserName, device }) => [
      {
        name: `author-${browserName}`,
        testMatch: /author\/.*\.spec\.ts/,
        dependencies: ["setup"],
        use: {
          ...device,
          storageState: path.resolve(__dirname, "playwright/.auth/author.json"),
        },
      },
      {
        name: `learner-${browserName}`,
        testMatch: /learner\/.*\.spec\.ts/,
        dependencies: ["setup"],
        use: {
          ...device,
          storageState: path.resolve(
            __dirname,
            "playwright/.auth/learner.json",
          ),
        },
      },
    ]),

    // Admin area (tests/admin): the admin flow uses an x-admin-token session,
    // NOT the learner/author cookie, so these specs spin up FRESH browser
    // contexts and never rely on a project storageState. Browser-driven, so it
    // gets a Chrome device but no default auth. No setup dependency: the specs
    // don't read the bootstrapped assignment cache.
    {
      name: "admin-chromium",
      testMatch: /admin\/.*\.spec\.ts/,
      use: {
        ...devices["Desktop Chrome"],
      },
    },

    // LTI (tests/lti): browser-driven launch specs build their own context and
    // perform the launch (no project storageState). lti-launch reads the
    // bootstrapped learner assignment from the cache, so depend on setup. The
    // pure-API passback spec also lives here and runs in the same project.
    {
      name: "lti-chromium",
      testMatch: /lti\/.*\.spec\.ts/,
      dependencies: ["setup"],
      use: {
        ...devices["Desktop Chrome"],
      },
    },

    // Authorization (tests/authz): API-level tests against the gateway. They
    // mint their own per-request cookies and seed their own assignments, so
    // they need NO storageState and NO browser. No setup dependency.
    {
      name: "authz",
      testMatch: /authz\/.*\.spec\.ts/,
    },

    // Health smoke (tests/health): unauthenticated API probes against the api
    // and gateway. No storageState, no browser, no setup dependency.
    {
      name: "health",
      testMatch: /health\/.*\.spec\.ts/,
    },
  ],

  webServer: [
    {
      command: "yarn --cwd apps/api start:e2e",
      url: `${testEnvironment.markApiBaseUrl}/health/readiness`,
    },
    {
      command: "yarn --cwd apps/api-gateway start:e2e",
      url: `${testEnvironment.gatewayBaseUrl}/health/readiness`,
    },
    {
      command: "yarn --cwd apps/web start:e2e",
      url: testEnvironment.webBaseUrl,
    },
  ].map((entry) => ({
    ...entry,
    timeout: 120_000,
    reuseExistingServer: !process.env.CI,
  })),
});
