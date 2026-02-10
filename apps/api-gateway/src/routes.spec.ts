/* eslint-disable */

import { ApiModule } from "./api/api.module";
import { HealthModule } from "./health/health.module";
import { routes } from "./routes";

describe("Routes", () => {
  it("should be defined", () => {
    expect(routes).toBeDefined();
  });

  it("should have correct number of routes", () => {
    expect(routes).toHaveLength(2);
  });

  it("should have API route at root path", () => {
    const apiRoute = routes.find((route) => route.path === "/");
    expect(apiRoute).toBeDefined();
    expect(apiRoute?.module).toBe(ApiModule);
  });

  it("should have Health route at /health/ path", () => {
    const healthRoute = routes.find((route) => route.path === "/health/");
    expect(healthRoute).toBeDefined();
    expect(healthRoute?.module).toBe(HealthModule);
  });
});
