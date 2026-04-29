import { test as setup, request } from "@playwright/test";
import { bootstrapPlaywrightState } from "../helpers/e2e-bootstrap";
import { getTestEnvironmentConfig } from "../helpers/assignment-helpers";

setup.setTimeout(300_000);

setup("bootstrap Playwright E2E state", async () => {
  await bootstrapPlaywrightState();

  const config = getTestEnvironmentConfig();
  await waitForUrl("web app", config.webBaseUrl, 120_000);
});

async function waitForUrl(name: string, url: string, timeoutMs: number) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const ctx = await request.newContext();
      try {
        const response = await ctx.get(url, { timeout: 5_000 });
        if (response.status() < 500) {
          console.log(`✓ ${name} is ready`);
          return;
        }
      } finally {
        await ctx.dispose();
      }
    } catch {
      // not ready yet, keep polling
    }
    await new Promise((resolve) => setTimeout(resolve, 2_000));
  }
  throw new Error(`Timed out waiting for ${name} at ${url}`);
}
