import { ConfigService } from "@nestjs/config";
import { Test, TestingModule } from "@nestjs/testing";
import { WINSTON_MODULE_PROVIDER } from "nest-winston";
import { Logger } from "winston";
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
        {
          provide: WINSTON_MODULE_PROVIDER,
          useValue: {
            child: jest.fn().mockReturnValue({}), // assuming 'child' method returns an object in real implementation.
          } as Partial<Logger>, // Partial<Logger> makes Logger optional, so that it's not necessary to implement every method of Logger.
        },
      ],
    }).compile();

    controller = module.get<ApiController>(ApiController);
  });

  it("should be defined", () => {
    expect(controller).toBeDefined();
  });
});
