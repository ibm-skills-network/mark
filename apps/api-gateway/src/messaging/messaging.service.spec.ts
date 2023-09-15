import { ConfigService } from "@nestjs/config";
import { Test, TestingModule } from "@nestjs/testing";
import { MessagingService } from "./messaging.service";

describe("MessagingService", () => {
  let service: MessagingService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [MessagingService, ConfigService],
    }).compile();

    service = module.get<MessagingService>(MessagingService);
  });

  it("should be defined", () => {
    expect(service).toBeDefined();
  });
});
