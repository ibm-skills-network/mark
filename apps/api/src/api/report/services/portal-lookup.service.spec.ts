import "reflect-metadata";
import { of, throwError } from "rxjs";
import { PortalLookupService } from "./portal-lookup.service";

const ENV: Record<string, string> = {
  PORTAL_MANAGER_API_BASE_URL: "https://portals.skills.network",
  PORTAL_MANAGER_TOKEN_URL: "https://portals.skills.network/oauth/token",
  PORTAL_MANAGER_UID: "mark-client",
  PORTAL_MANAGER_SECRET: "mark-secret", // pragma: allowlist secret
};

const portal = (overrides: Record<string, unknown> = {}) => ({
  name: "Blitz Academy",
  domain: "blitzacademy.skillsnetwork.site",
  support_product_id: "fcb9d787-481b-4b3a-95c5-511b8b2b987f",
  support_product_name: "ICE",
  datacenter: "portals-prod-india-academic",
  is_active: true,
  ...overrides,
});

const make = (env: Record<string, string> = ENV) => {
  const httpService = { get: jest.fn(), post: jest.fn() };
  const configService = { get: jest.fn((key: string) => env[key]) };
  httpService.post.mockReturnValue(
    of({ data: { access_token: "pm-token", expires_in: 3600 } }),
  );
  const service = new PortalLookupService(
    httpService as never,
    configService as never,
  );
  return { service, httpService };
};

describe("PortalLookupService", () => {
  // portal-manager runs Doorkeeper, whose client-credentials grant expects a
  // form-encoded body (RFC 6749 §2.3.1), not JSON.
  it("requests the access token as a form-encoded client-credentials grant", async () => {
    const { service, httpService } = make();
    httpService.get.mockReturnValue(of({ data: { data: [portal()] } }));

    await service.findByHost("blitzacademy.skillsnetwork.site");

    const [url, body, config] = httpService.post.mock.calls[0];
    expect(url).toBe("https://portals.skills.network/oauth/token");
    expect(config.headers["content-type"]).toBe(
      "application/x-www-form-urlencoded",
    );
    expect(Object.fromEntries(new URLSearchParams(body as string))).toEqual({
      grant_type: "client_credentials",
      client_id: "mark-client",
      client_secret: "mark-secret", // pragma: allowlist secret
    });
  });

  it("returns the portal registered for a host", async () => {
    const { service, httpService } = make();
    httpService.get.mockReturnValue(of({ data: { data: [portal()] } }));

    await expect(
      service.findByHost("blitzacademy.skillsnetwork.site"),
    ).resolves.toEqual({
      portalName: "Blitz Academy",
      productName: "ICE",
      productId: "fcb9d787-481b-4b3a-95c5-511b8b2b987f",
      datacenter: "portals-prod-india-academic",
    });

    const [url, config] = httpService.get.mock.calls[0];
    expect(url).toContain(
      "/api/v1/portals?filter%5Bby_domain%5D=blitzacademy.skillsnetwork.site",
    );
    expect(config.headers.Authorization).toBe("Bearer pm-token");
    expect(config.timeout).toBe(3000);
  });

  // An unfiltered response is the whole portal list, which would otherwise
  // look exactly like a match.
  it("rejects a record whose domain is not the host asked for", async () => {
    const { service, httpService } = make();
    httpService.get.mockReturnValue(
      of({ data: { data: [portal({ domain: "someone-else.example" })] } }),
    );

    await expect(
      service.findByHost("blitzacademy.skillsnetwork.site"),
    ).resolves.toBeUndefined();
  });

  it("retries without an entry-point label", async () => {
    const { service, httpService } = make();
    httpService.get
      .mockReturnValueOnce(of({ data: { data: [] } }))
      .mockReturnValueOnce(
        of({
          data: {
            data: [
              portal({
                name: "Lovely Professional University",
                domain: "lpu.cognitiveclass.ai",
              }),
            ],
          },
        }),
      );

    const record = await service.findByHost("courses.lpu.cognitiveclass.ai");

    expect(record?.portalName).toBe("Lovely Professional University");
    expect(httpService.get).toHaveBeenCalledTimes(2);
  });

  it("prefers an active portal when a domain has more than one record", async () => {
    const { service, httpService } = make();
    httpService.get.mockReturnValue(
      of({
        data: {
          data: [
            portal({ name: "Retired", is_active: false }),
            portal({ name: "Current", is_active: true }),
          ],
        },
      }),
    );

    const record = await service.findByHost("blitzacademy.skillsnetwork.site");
    expect(record?.portalName).toBe("Current");
  });

  it("caches hits, misses and the access token", async () => {
    const { service, httpService } = make();
    httpService.get.mockReturnValue(of({ data: { data: [portal()] } }));

    await service.findByHost("blitzacademy.skillsnetwork.site");
    await service.findByHost("blitzacademy.skillsnetwork.site");
    expect(httpService.get).toHaveBeenCalledTimes(1);
    expect(httpService.post).toHaveBeenCalledTimes(1);

    httpService.get.mockReturnValue(of({ data: { data: [] } }));
    await service.findByHost("unknown.example");
    await service.findByHost("unknown.example");
    expect(httpService.get).toHaveBeenCalledTimes(2);
  });

  it("degrades to undefined when portal-manager fails", async () => {
    const { service, httpService } = make();
    httpService.get.mockReturnValue(
      throwError(() => new Error("connect ETIMEDOUT")),
    );

    await expect(
      service.findByHost("blitzacademy.skillsnetwork.site"),
    ).resolves.toBeUndefined();
  });

  it("degrades to undefined when the token request fails", async () => {
    const { service, httpService } = make();
    httpService.post.mockReturnValue(throwError(() => new Error("401")));

    await expect(
      service.findByHost("blitzacademy.skillsnetwork.site"),
    ).resolves.toBeUndefined();
    expect(httpService.get).not.toHaveBeenCalled();
  });

  it("does not call out when portal-manager is unconfigured", async () => {
    const { service, httpService } = make({});

    expect(service.isConfigured()).toBe(false);
    await expect(
      service.findByHost("anything.example"),
    ).resolves.toBeUndefined();
    expect(httpService.post).not.toHaveBeenCalled();
    expect(httpService.get).not.toHaveBeenCalled();
  });

  it("ignores an empty host", async () => {
    const { service, httpService } = make();
    await expect(service.findByHost("  ")).resolves.toBeUndefined();
    expect(httpService.get).not.toHaveBeenCalled();
  });
});
