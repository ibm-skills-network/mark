#!/usr/bin/env ts-node
import { bootstrapPlaywrightState } from "./e2e-bootstrap";

bootstrapPlaywrightState().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`\n❌ Error: ${message}`);
  process.exit(1);
});
