import { test as setup } from "@playwright/test";
import { bootstrapPlaywrightState } from "../helpers/e2e-bootstrap";

setup.setTimeout(120_000);

setup("bootstrap Playwright E2E state", async () => {
  await bootstrapPlaywrightState();
});
