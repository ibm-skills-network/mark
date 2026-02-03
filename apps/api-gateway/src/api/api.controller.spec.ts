import { ConfigService } from "@nestjs/config";
import { Test, TestingModule } from "@nestjs/testing";
import { WINSTON_MODULE_PROVIDER } from "nest-winston";
import { Logger } from "winston";
import { JwtBearerTokenAuthGuard } from "../auth/jwt/bearer-token-based/jwt.bearer.token.auth.guard";
import { MockJwtBearerTokenAuthGuard } from "../auth/jwt/bearer-token-based/mock.jwt.bearer.token.auth.guard";
import { JwtCookieAuthGuard } from "../auth/jwt/cookie-based/jwt.cookie.auth.guard";
import { MockJwtCookieAuthGuard } from "../auth/jwt/cookie-based/mock.jwt.cookie.auth.guard";
import { MessagingService } from "../messaging/messaging.service";
import { ApiController } from "./api.controller";
import { ApiService } from "./api.service";

describe("ApiController", () => {
  let controller: ApiController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [ApiController],
      providers: [
        ConfigService,
        MessagingService,
        ApiService,
        JwtBearerTokenAuthGuard,
        MockJwtBearerTokenAuthGuard,
        JwtCookieAuthGuard,
        MockJwtCookieAuthGuard,
        {
          provide: WINSTON_MODULE_PROVIDER,
          useValue: {
            child: jest.fn().mockReturnValue({}),
          } as Partial<Logger>,
        },
      ],
    }).compile();

    controller = module.get<ApiController>(ApiController);
  });

  it("should be defined", () => {
    expect(controller).toBeDefined();
  });
});
