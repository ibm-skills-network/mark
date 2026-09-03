import { HttpService } from "@nestjs/axios";
import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { firstValueFrom } from "rxjs";

/**
 * portal-manager (https://portals.skills.network) is the source of truth for
 * which portal a hostname belongs to and which SN Support product owns it. A
 * hostname suffix cannot answer that — courses.lpu.cognitiveclass.ai is an
 * India-academic portal (ICE), not Cognitive Class — so support routing asks
 * this service rather than guessing.
 */
export interface PortalRecord {
  portalName: string;
  productName?: string;
  productId?: string;
  datacenter?: string;
}

interface PortalManagerPortal {
  name?: string;
  domain?: string;
  support_product_id?: string;
  support_product_name?: string;
  datacenter?: string;
  is_active?: boolean;
}

// Subdomains that identify an entry point rather than a portal, so a miss on
// the full host is retried without them (courses.lpu.cognitiveclass.ai ->
// lpu.cognitiveclass.ai). Mirrors sn-assistant's ENTRY_POINT_LABELS.
const ENTRY_POINT_LABELS = new Set(["www", "apps", "courses"]);

const REQUEST_TIMEOUT_MS = 3000;
const CACHE_TTL_MS = 15 * 60 * 1000;
// Refresh slightly early so a token cannot expire mid-flight.
const TOKEN_EXPIRY_SKEW_MS = 60 * 1000;

@Injectable()
export class PortalLookupService {
  private readonly logger = new Logger(PortalLookupService.name);
  private readonly cache = new Map<
    string,
    { record?: PortalRecord; expiresAt: number }
  >();
  private accessToken?: { value: string; expiresAt: number };
  private pendingToken?: Promise<string | undefined>;

  constructor(
    private readonly httpService: HttpService,
    private readonly configService: ConfigService,
  ) {}

  isConfigured(): boolean {
    return Boolean(
      this.setting("PORTAL_MANAGER_API_BASE_URL") &&
        this.setting("PORTAL_MANAGER_TOKEN_URL") &&
        this.setting("PORTAL_MANAGER_UID") &&
        this.setting("PORTAL_MANAGER_SECRET"),
    );
  }

  /**
   * The portal registered for `host`, or undefined when portal-manager is
   * unconfigured, unreachable, or does not know the host. Never throws and
   * never rejects: a lookup failure must degrade routing, not fail a report.
   */
  async findByHost(host?: string): Promise<PortalRecord | undefined> {
    const normalizedHost = host?.trim().toLowerCase();
    if (!normalizedHost || !this.isConfigured()) return;

    const candidates = [normalizedHost, stripEntryPointLabel(normalizedHost)];
    for (const candidate of candidates) {
      if (!candidate) continue;
      const record = await this.lookupCached(candidate);
      if (record) return record;
    }
    return;
  }

  private setting(key: string): string | undefined {
    const value = this.configService.get<string>(key)?.trim();
    return value || undefined;
  }

  private async lookupCached(host: string): Promise<PortalRecord | undefined> {
    const cached = this.cache.get(host);
    if (cached && cached.expiresAt > Date.now()) return cached.record;

    const record = await this.lookup(host);
    // Misses are cached too, so an unknown host does not call out on every
    // report.
    this.cache.set(host, { record, expiresAt: Date.now() + CACHE_TTL_MS });
    return record;
  }

  private async lookup(host: string): Promise<PortalRecord | undefined> {
    const token = await this.token();
    if (!token) return;

    const baseUrl = this.setting("PORTAL_MANAGER_API_BASE_URL")?.replace(
      /\/+$/,
      "",
    );

    try {
      const response = await firstValueFrom(
        this.httpService.get<{ data?: PortalManagerPortal[] }>(
          `${baseUrl}/api/v1/portals?filter%5Bby_domain%5D=${encodeURIComponent(host)}`,
          {
            headers: { Authorization: `Bearer ${token}` },
            timeout: REQUEST_TIMEOUT_MS,
          },
        ),
      );

      // An unfiltered answer is the entire portal list and is otherwise
      // indistinguishable from a hit, so the domain is re-checked here.
      const matches = (response.data?.data ?? []).filter(
        (portal) => normalizeDomain(portal.domain) === host,
      );
      const portal = matches.find((entry) => entry.is_active) ?? matches[0];
      if (!portal) return;

      return {
        portalName: portal.name?.trim() || host,
        productName: portal.support_product_name?.trim() || undefined,
        productId: portal.support_product_id?.trim() || undefined,
        datacenter: portal.datacenter?.trim() || undefined,
      };
    } catch (error) {
      this.logger.warn("portal-manager lookup failed", {
        host,
        error: error instanceof Error ? error.message : String(error),
      });
      return;
    }
  }

  private async token(): Promise<string | undefined> {
    if (this.accessToken && this.accessToken.expiresAt > Date.now()) {
      return this.accessToken.value;
    }
    // Collapse concurrent refreshes; reports can arrive together.
    this.pendingToken ??= this.requestToken().finally(() => {
      this.pendingToken = undefined;
    });
    return this.pendingToken;
  }

  private async requestToken(): Promise<string | undefined> {
    const tokenUrl = this.setting("PORTAL_MANAGER_TOKEN_URL");
    if (!tokenUrl) return;

    try {
      // Doorkeeper's client-credentials grant, form-encoded as RFC 6749 and
      // portal-manager's own README specify.
      const form = new URLSearchParams({
        grant_type: "client_credentials",
        client_id: this.setting("PORTAL_MANAGER_UID") ?? "",
        client_secret: this.setting("PORTAL_MANAGER_SECRET") ?? "",
      });

      const response = await firstValueFrom(
        this.httpService.post<{ access_token?: string; expires_in?: number }>(
          tokenUrl,
          form.toString(),
          {
            headers: {
              "content-type": "application/x-www-form-urlencoded",
            },
            timeout: REQUEST_TIMEOUT_MS,
          },
        ),
      );

      const value = response.data?.access_token;
      if (!value) {
        this.logger.warn("portal-manager returned no access token");
        return;
      }

      const expiresInMs = (response.data?.expires_in ?? 3600) * 1000;
      this.accessToken = {
        value,
        expiresAt: Date.now() + Math.max(expiresInMs - TOKEN_EXPIRY_SKEW_MS, 0),
      };
      return value;
    } catch (error) {
      // Never log the credentials or the axios config that carries them.
      this.logger.warn("portal-manager token request failed", {
        error: error instanceof Error ? error.message : String(error),
      });
      return;
    }
  }
}

function normalizeDomain(domain?: string): string | undefined {
  const trimmed = domain?.trim().toLowerCase();
  if (!trimmed) return;
  return trimmed
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(/[/:].*$/, "");
}

function stripEntryPointLabel(host: string): string | undefined {
  const [label, ...rest] = host.split(".");
  if (rest.length < 2 || !ENTRY_POINT_LABELS.has(label)) return;
  return rest.join(".");
}
