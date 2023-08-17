import { ConfigService } from "@nestjs/config";
import { Test, TestingModule } from "@nestjs/testing";
import { WINSTON_MODULE_PROVIDER } from "nest-winston";
import { Logger } from "winston";
import { MessagingService } from "../messaging/messaging.service";
import { ApiService } from "./api.service";

describe("ApiService", () => {
  let service: ApiService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ApiService,
        MessagingService,
        ConfigService,
        {
          provide: WINSTON_MODULE_PROVIDER,
          useValue: {
            child: jest.fn().mockReturnValue({}), // assuming 'child' method returns an object in real implementation.
          } as Partial<Logger>, // Partial<Logger> makes Logger optional, so that it's not necessary to implement every method of Logger.
        },
      ],
    }).compile();

    service = module.get<ApiService>(ApiService);
  });

  it("should be defined", () => {
    expect(service).toBeDefined();
  });
});
