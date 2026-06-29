import { AdminOverrideService } from "./admin-override.service";
import { JwtService } from "@nestjs/jwt";
import { JwtConfigService } from "../auth/jwt/jwt.config.service";
import axios from "axios";
jest.mock("axios");

describe("AdminOverrideService", () => {
  const jwt = new JwtService({});
  const cfg = new JwtConfigService();
  const logger = {
    child: () => ({ warn: jest.fn(), info: jest.fn() }),
  } as never;
  const svc = new AdminOverrideService(jwt, cfg, logger);

  it("returns undefined when the token is not an admin", async () => {
    (axios.post as jest.Mock).mockResolvedValue({ data: { isAdmin: false } });
    expect(await svc.mintOverrideCookie("tok")).toBeUndefined();
  });

  it("mints an HS256 cookie with adminOverride + role=author for an admin", async () => {
    (axios.post as jest.Mock).mockResolvedValue({
      data: { isAdmin: true, email: "admin@ibm.com" },
    });
    const result = await svc.mintOverrideCookie("tok");
    expect(result).toBeDefined();
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const decoded: Record<string, unknown> = jwt.verify(result!.token, {
      secret: cfg.jwtConstants.secret,
    }); //pragma: allowlist secret
    expect(decoded).toMatchObject({
      userID: "admin@ibm.com",
      role: "author",
      adminOverride: true,
    });
  });
});
