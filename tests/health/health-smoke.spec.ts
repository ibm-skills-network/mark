/**
 * Health smoke (cross-cutting, API-level).
 *
 * The mark api and the api-gateway each expose Terminus health probes on a
 * VERSION_NEUTRAL controller:
 *   - apps/api/src/health/health.controller.ts          -> /health/{liveness,readiness}
 *   - apps/api-gateway/src/health/health.controller.ts  -> /health, /health/{liveness,readiness}
 * Terminus returns 200 with a body of shape { status: "ok", info, error, details }
 * when all (here: zero) indicators pass. playwright.config's webServer already
 * gates startup on `${markApiBaseUrl}/health/readiness` and
 * `${gatewayBaseUrl}/health/readiness`, so both are reachable once tests run.
 *
 * No auth: these probes are unauthenticated by design (k8s liveness/readiness), // pragma: allowlist secret
 * so this spec needs no cookie and no project storageState. It builds its own
 * request contexts straight at each service base url (the gateway and the api
 * are SEPARATE origins). The Integrate phase registers an API-only Playwright
 * project for this directory.
 */
import {
  type APIRequestContext,
  expect,
  request,
  test,
} from "@playwright/test";
import {
  getTestEnvironmentConfig,
  type TestEnvironmentConfig,
} from "../helpers/assignment-helpers";

const config: TestEnvironmentConfig = getTestEnvironmentConfig();

test.describe("Health smoke (api + gateway)", () => {
  let api: APIRequestContext;
  let gateway: APIRequestContext;

  test.beforeAll(async () => {
    api = await request.newContext({ baseURL: config.markApiBaseUrl });
    gateway = await request.newContext({ baseURL: config.gatewayBaseUrl });
  });

  test.afterAll(async () => {
    await api.dispose();
    await gateway.dispose();
  });

  test("api /health/readiness returns 200 with status ok", async () => {
    const response = await api.get("/health/readiness");
    expect(response.status()).toBe(200);
    const body = (await response.json()) as { status?: string };
    expect(body.status).toBe("ok");
  });

  test("api /health/liveness returns 200 with status ok", async () => {
    const response = await api.get("/health/liveness");
    expect(response.status()).toBe(200);
    const body = (await response.json()) as { status?: string };
    expect(body.status).toBe("ok");
  });

  test("gateway /health/readiness returns 200 with status ok", async () => {
    const response = await gateway.get("/health/readiness");
    expect(response.status()).toBe(200);
    const body = (await response.json()) as { status?: string };
    expect(body.status).toBe("ok");
  });

  test("gateway /health/liveness returns 200 with status ok", async () => {
    const response = await gateway.get("/health/liveness");
    expect(response.status()).toBe(200);
    const body = (await response.json()) as { status?: string };
    expect(body.status).toBe("ok");
  });
});
