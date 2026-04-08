import path from "node:path";
import { defineConfig, devices } from "@playwright/test";
import { getTestEnvironmentConfig } from "./tests/helpers/assignment-helpers";

/**
 * Read environment variables from file.
 * https://github.com/motdotla/dotenv
 */
// import dotenv from 'dotenv';
// import path from 'path';
// dotenv.config({ path: path.resolve(__dirname, '.env') });

const testEnvironment = getTestEnvironmentConfig();

/**
 * See https://playwright.dev/docs/test-configuration.
 */
export default defineConfig({
  testDir: "./tests",

  testIgnore: [
    "apps/api/**",
    "apps/api-gateway/**",
    "**/__tests__/**",
    "tests/examples/**",
  ],

  /* Run tests in files in parallel */
  fullyParallel: true,
  /* Fail the build on CI if you accidentally left test.only in the source code. */
  forbidOnly: !!process.env.CI,
  /* Retry on CI only */
  retries: process.env.CI ? 2 : 0,
  /* Opt out of parallel tests on CI. */
  workers: process.env.CI ? 1 : undefined,
  /* Reporter to use. See https://playwright.dev/docs/test-reporters */
  reporter: "html",
  /* Shared settings for all the projects below. See https://playwright.dev/docs/api/class-testoptions. */
  use: {
    baseURL: testEnvironment.webBaseUrl,

    /* Base URL to use in actions like `await page.goto('')`. */
    // baseURL: 'http://localhost:3000',

    /* Collect trace when retrying the failed test. See https://playwright.dev/docs/trace-viewer */
    trace: "on-first-retry",
  },

  /* Configure projects for role/browser combinations with a shared setup dependency. */
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

  webServer: {
    command: "yarn start:e2e",
    url: testEnvironment.webBaseUrl,
    timeout: 300_000,
    reuseExistingServer: !process.env.CI,
  },
});
