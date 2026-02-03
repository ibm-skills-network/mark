/* eslint-disable */

import { Test, TestingModule } from "@nestjs/testing";
import { AuthModule } from "./auth.module";
import { JwtBearerTokenStrategy } from "./jwt/bearer-token-based/jwt.bearer.token.strategy";
import { JwtCookieStrategy } from "./jwt/cookie-based/jwt.cookie.strategy";
import { JwtConfigService } from "./jwt/jwt.config.service";

describe("AuthModule", () => {
  let module: TestingModule;

  beforeEach(async () => {
    process.env.SECRET = "test-secret";

    module = await Test.createTestingModule({
      imports: [AuthModule],
    }).compile();
  });

  afterEach(() => {
    delete process.env.SECRET;
  });

  it("should be defined", () => {
    expect(module).toBeDefined();
  });

  it("should have JwtConfigService defined", () => {
    const service = module.get<JwtConfigService>(JwtConfigService);
    expect(service).toBeDefined();
  });

  it("should have JwtCookieStrategy defined", () => {
    const strategy = module.get<JwtCookieStrategy>(JwtCookieStrategy);
    expect(strategy).toBeDefined();
  });

  it("should have JwtBearerTokenStrategy defined", () => {
    const strategy = module.get<JwtBearerTokenStrategy>(JwtBearerTokenStrategy);
    expect(strategy).toBeDefined();
  });
});
