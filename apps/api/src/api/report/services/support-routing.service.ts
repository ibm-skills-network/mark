import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { PortalContext } from "src/common/portal/portal-context";
import { PortalLookupService } from "./portal-lookup.service";

/**
 * Picks the SN Support credential a report is filed with.
 *
 * SN Support resolves a ticket's product from the API key alone — the v2
 * create contract has no product field and rejects unknown keys — so "route
 * this ticket to the portal's product" means "call with that product's token".
 * This service is the only place in Mark that knows that; if SN Support ever
 * resolves the product server-side, deleting it and the SUPPORT_TOKEN_* vars
 * removes the whole mechanism.
 *
 * sn-assistant (src/support.ts) implements the same policy for its own
 * tickets; the two are independent copies and can drift.
 */
export interface SupportRoute {
  token?: string;
  /** SN Support product the token belongs to, for logging. */
  productName?: string;
  /** Portal display name from portal-manager, when it knew the host. */
  portalName?: string;
  via: "portal-manager" | "label" | "default" | "legacy" | "none";
}

const TOKEN_ENV_PREFIX = "SUPPORT_TOKEN_";
const DEFAULT_PRODUCT = "Portals";

// portal-manager stamps this product on every portal in the two India
// datacenters; matching by id as well as name survives a display-name change.
const PRODUCT_NAME_BY_ID: Record<string, string> = {
  "fcb9d787-481b-4b3a-95c5-511b8b2b987f": "ICE",
};

// Only used for the startup diagnostic below — routing itself never consults
// this list, so a new product needs a secret and no code change.
const EXPECTED_PRODUCTS = [
  "Portals",
  "Cognitive Class",
  "Coursera",
  "edX",
  "ICE",
  "Labs",
  "Faculty",
];

/** "Cognitive Class" -> "SUPPORT_TOKEN_COGNITIVE_CLASS" */
export function tokenEnvironmentVariableFor(productName: string): string {
  const normalized = productName
    .trim()
    .toUpperCase()
    .replaceAll(/[^\dA-Z]+/g, "_")
    .replaceAll(/^_+|_+$/g, "");
  return `${TOKEN_ENV_PREFIX}${normalized}`;
}

@Injectable()
export class SupportRoutingService implements OnModuleInit {
  private readonly logger = new Logger(SupportRoutingService.name);

  constructor(
    private readonly configService: ConfigService,
    private readonly portalLookup: PortalLookupService,
  ) {}

  /**
   * Nothing validates env at boot in this app, and a missing token is
   * invisible until a report is filed against that portal — so say which
   * products can be reached while someone is still watching the deploy.
   */
  onModuleInit(): void {
    const configured = EXPECTED_PRODUCTS.filter((product) =>
      this.tokenFor(product),
    );
    const missing = EXPECTED_PRODUCTS.filter(
      (product) => !this.tokenFor(product),
    );

    this.logger.log("SN Support routing configured", {
      products: configured,
      portal_manager: this.portalLookup.isConfigured(),
    });
    if (missing.length > 0) {
      this.logger.warn(
        `No SN Support token for: ${missing.join(", ")} — reports from those portals fall back to ${DEFAULT_PRODUCT}`,
      );
    }
  }

  async resolve(portal: PortalContext): Promise<SupportRoute> {
    const record = await this.portalLookup.findByHost(portal.portalHost);
    const productFromPortal =
      record?.productName ??
      (record?.productId ? PRODUCT_NAME_BY_ID[record.productId] : undefined);

    if (productFromPortal) {
      const token = this.tokenFor(productFromPortal);
      if (token) {
        return {
          token,
          productName: productFromPortal,
          portalName: record?.portalName,
          via: "portal-manager",
        };
      }
      this.logger.warn(
        `No SN Support token for product "${productFromPortal}" (${tokenEnvironmentVariableFor(productFromPortal)}); falling back`,
      );
    }

    // Coursera and edX are LTI platforms rather than portals, so
    // portal-manager has no record of them; their names are the product names.
    if (portal.portalName) {
      const token = this.tokenFor(portal.portalName);
      if (token) {
        return {
          token,
          productName: portal.portalName,
          portalName: record?.portalName,
          via: "label",
        };
      }
    }

    const defaultToken = this.tokenFor(DEFAULT_PRODUCT);
    if (defaultToken) {
      return {
        token: defaultToken,
        productName: DEFAULT_PRODUCT,
        portalName: record?.portalName,
        via: "default",
      };
    }

    // Pre-routing deploys (and local dev) still have a single token.
    const legacyToken = this.configService
      .get<string>("SN_SUPPORT_TOKEN")
      ?.trim();
    return legacyToken
      ? { token: legacyToken, portalName: record?.portalName, via: "legacy" }
      : { portalName: record?.portalName, via: "none" };
  }

  private tokenFor(productName?: string): string | undefined {
    if (!productName) return;
    const environmentVariable = tokenEnvironmentVariableFor(productName);
    if (environmentVariable === TOKEN_ENV_PREFIX) return;
    return (
      this.configService.get<string>(environmentVariable)?.trim() || undefined
    );
  }
}
