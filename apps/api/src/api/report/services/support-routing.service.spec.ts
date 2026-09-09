import "reflect-metadata";
import {
  SupportRoutingService,
  tokenEnvironmentVariableFor,
} from "./support-routing.service";

const ICE_PRODUCT_ID = "fcb9d787-481b-4b3a-95c5-511b8b2b987f";

// Every product Mark can reach has its own key, because SN Support resolves a
// ticket's product from the API key alone.
const TOKENS: Record<string, string> = {
  SUPPORT_TOKEN_PORTALS: "sk_portals",
  SUPPORT_TOKEN_COGNITIVE_CLASS: "sk_cc",
  SUPPORT_TOKEN_COURSERA: "sk_coursera",
  SUPPORT_TOKEN_EDX: "sk_edx",
  SUPPORT_TOKEN_ICE: "sk_ice",
  SUPPORT_TOKEN_LABS: "sk_labs",
  SUPPORT_TOKEN_FACULTY: "sk_faculty",
};

const make = (
  portalRecord?: Record<string, unknown>,
  env: Record<string, string> = TOKENS,
) => {
  const portalLookup = {
    findByHost: jest.fn().mockResolvedValue(portalRecord),
    isConfigured: jest.fn().mockReturnValue(true),
  };
  const configService = { get: jest.fn((key: string) => env[key]) };
  const service = new SupportRoutingService(
    configService as never,
    portalLookup as never,
  );
  return { service, portalLookup };
};

describe("tokenEnvironmentVariableFor", () => {
  it.each([
    ["Cognitive Class", "SUPPORT_TOKEN_COGNITIVE_CLASS"],
    ["Coursera", "SUPPORT_TOKEN_COURSERA"],
    ["edX", "SUPPORT_TOKEN_EDX"],
    ["ICE", "SUPPORT_TOKEN_ICE"],
    ["  Author Workbench  ", "SUPPORT_TOKEN_AUTHOR_WORKBENCH"],
  ])("maps %s to %s", (product, envVar) => {
    expect(tokenEnvironmentVariableFor(product)).toBe(envVar);
  });
});

describe("SupportRoutingService.resolve", () => {
  it("uses the product portal-manager reports for the portal", async () => {
    const { service } = make({
      portalName: "Cognitive Class",
      productName: "Cognitive Class",
    });

    await expect(
      service.resolve({
        portalHost: "cognitiveclass.ai",
        portalName: "cognitiveclass.ai",
      }),
    ).resolves.toEqual({
      token: "sk_cc",
      productName: "Cognitive Class",
      portalName: "Cognitive Class",
      via: "portal-manager",
    });
  });

  // The case a domain table would get wrong: an India-academic portal that
  // happens to live on the Cognitive Class domain belongs to ICE.
  it("routes a partner portal on a platform domain to its cluster product", async () => {
    const { service } = make({
      portalName: "Lovely Professional University",
      productName: "ICE",
      datacenter: "portals-prod-india-academic",
    });

    const route = await service.resolve({
      portalHost: "courses.lpu.cognitiveclass.ai",
      portalName: "courses.lpu.cognitiveclass.ai",
    });

    expect(route).toMatchObject({ token: "sk_ice", productName: "ICE" });
  });

  it.each([undefined, "Renamed ICE"])(
    "recognizes ICE by product id when the name is %s",
    async (productName) => {
      const { service } = make({
        portalName: "Blitz Academy",
        productId: ICE_PRODUCT_ID,
        productName,
      });

      const route = await service.resolve({
        portalHost: "blitzacademy.skillsnetwork.site",
        portalName: "blitzacademy.skillsnetwork.site",
      });

      expect(route).toMatchObject({
        token: "sk_ice",
        productName: "ICE",
        portalName: "Blitz Academy",
      });
    },
  );

  // Coursera and edX launch over LTI and are not portals, so portal-manager
  // has no record of them; their platform label is the product name.
  it.each([
    ["Coursera", "coursera.org", "sk_coursera"],
    ["edX", "edx.org", "sk_edx"],
    ["Faculty", "author.skills.network", "sk_faculty"],
  ])("routes the %s platform by label", async (label, host, token) => {
    const { service } = make(undefined);

    await expect(
      service.resolve({ portalHost: host, portalName: label }),
    ).resolves.toEqual({
      token,
      productName: label,
      portalName: undefined,
      via: "label",
    });
  });

  it("falls back to Portals for a portal nobody knows", async () => {
    const { service } = make(undefined);

    const route = await service.resolve({
      portalHost: "unknown.example.edu",
      portalName: "unknown.example.edu",
    });

    expect(route).toMatchObject({
      token: "sk_portals",
      productName: "Portals",
      via: "default",
    });
  });

  it("falls back to Portals for a session with no portal at all", async () => {
    const { service, portalLookup } = make(undefined);

    const route = await service.resolve({});

    expect(portalLookup.findByHost).toHaveBeenCalledWith(undefined);
    expect(route).toMatchObject({ token: "sk_portals", via: "default" });
  });

  it("falls back when the matched product has no token configured", async () => {
    const { service } = make(
      { portalName: "Some Portal", productName: "Brand New Product" },
      TOKENS,
    );

    const route = await service.resolve({
      portalHost: "new.skillsnetwork.site",
      portalName: "new.skillsnetwork.site",
    });

    expect(route).toMatchObject({ token: "sk_portals", via: "default" });
  });

  it("uses the legacy single token when no product tokens exist", async () => {
    const { service } = make(undefined, { SN_SUPPORT_TOKEN: "sk_legacy" });

    const route = await service.resolve({
      portalHost: "cognitiveclass.ai",
      portalName: "cognitiveclass.ai",
    });

    expect(route).toMatchObject({ token: "sk_legacy", via: "legacy" });
  });

  it("reports no route when nothing is configured", async () => {
    const { service } = make(undefined, {});

    await expect(service.resolve({ portalHost: "x.example" })).resolves.toEqual(
      { portalName: undefined, via: "none" },
    );
  });

  it.each([undefined, "unknown.example"])(
    "ignores client labels for host %s",
    async (portalHost) => {
      const { service } = make();
      await expect(
        service.resolve({ portalHost, portalName: "ICE" }),
      ).resolves.toMatchObject({
        token: "sk_portals",
        via: "default",
      });
    },
  );

  it("does not override a known portal's missing product key with a platform label", async () => {
    const { service } = make({
      portalName: "Partner",
      productName: "New Product",
    });
    await expect(
      service.resolve({ portalHost: "courses.edx.org", portalName: "edX" }),
    ).resolves.toMatchObject({
      token: "sk_portals",
      via: "default",
    });
  });
});
