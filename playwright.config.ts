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
