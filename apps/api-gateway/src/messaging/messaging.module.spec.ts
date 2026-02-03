/* eslint-disable */
import { ConfigModule } from "@nestjs/config";
import { Test, TestingModule } from "@nestjs/testing";
import { MessagingModule } from "./messaging.module";
import { MessagingService } from "./messaging.service";

describe("MessagingModule", () => {
  let module: TestingModule;

  beforeEach(async () => {
    module = await Test.createTestingModule({
      imports: [ConfigModule.forRoot(), MessagingModule],
    }).compile();
  });

  it("should be defined", () => {
    expect(module).toBeDefined();
  });

  it("should have MessagingService defined", () => {
    const service = module.get<MessagingService>(MessagingService);
    expect(service).toBeDefined();
  });

  it("should export MessagingService", async () => {
    const exportedModule = await Test.createTestingModule({
      imports: [ConfigModule.forRoot(), MessagingModule],
    }).compile();

    const service = exportedModule.get<MessagingService>(MessagingService);
    expect(service).toBeDefined();
  });
});
