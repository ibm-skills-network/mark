import { Inject, Injectable } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { WINSTON_MODULE_PROVIDER } from "nest-winston";
import axios from "axios";
import { Logger } from "winston";
import { JwtConfigService } from "../auth/jwt/jwt.config.service";

interface AdminMeResponse {
  isAdmin: boolean;
  email: string;
  role?: string;
}

@Injectable()
export class AdminOverrideService {
  private readonly logger: Logger;
  constructor(
    private readonly jwt: JwtService,
    private readonly cfg: JwtConfigService,
    @Inject(WINSTON_MODULE_PROVIDER) parentLogger: Logger,
  ) {
    this.logger = parentLogger.child({ context: AdminOverrideService.name });
  }

  private ttlMinutes(): number {
    const n = Number(process.env.ADMIN_OVERRIDE_TTL_MINUTES);
    return Number.isFinite(n) && n > 0 ? n : 60;
  }

  /** Verify the admin session token via the api, then sign an override cookie. */
  async mintOverrideCookie(
    sessionToken: string,
  ): Promise<{ token: string; expiresAt: string } | undefined> {
    if (!sessionToken) return undefined;
    let isAdmin = false;
    let email = "";
    try {
      const url = `${process.env.MARK_API_ENDPOINT ?? ""}/api/v1/auth/admin/me`;
      const { data } = await axios.post<AdminMeResponse>(url, { sessionToken });
      isAdmin = data?.isAdmin === true;
      email = data?.email ?? "";
    } catch {
      // Generic failure path — do not leak why.
      return undefined;
    }
    if (!isAdmin || !email) return undefined;

    const minutes = this.ttlMinutes();
    const token = this.jwt.sign(
      { userID: email, role: "author", adminOverride: true },
      {
        secret: this.cfg.jwtConstants.secret, //pragma: allowlist secret
        algorithm: "HS256",
        expiresIn: `${minutes}m`,
      },
    );
    const expiresAt = new Date(Date.now() + minutes * 60_000).toISOString();
    this.logger.warn("admin_override_minted", {
      admin_email: email,
      ttl_minutes: minutes,
    });
    return { token, expiresAt };
  }
}
