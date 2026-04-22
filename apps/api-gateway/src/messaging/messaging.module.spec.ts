/* eslint-disable */
import { Global, Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { Test, TestingModule } from "@nestjs/testing";
import { WINSTON_MODULE_PROVIDER } from "nest-winston";
import { MessagingModule } from "./messaging.module";
import { MessagingService } from "./messaging.service";

const mockLogger = {
  child: jest.fn().mockReturnValue({
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
  }),
  info: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn(),
};

@Global()
@Module({
  providers: [{ provide: WINSTON_MODULE_PROVIDER, useValue: mockLogger }],
  exports: [WINSTON_MODULE_PROVIDER],
})
class MockWinstonModule {}

describe("MessagingModule", () => {
  let module: TestingModule;

  beforeEach(async () => {
    module = await Test.createTestingModule({
      imports: [ConfigModule.forRoot(), MockWinstonModule, MessagingModule],
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
      imports: [ConfigModule.forRoot(), MockWinstonModule, MessagingModule],
    }).compile();

    const service = exportedModule.get<MessagingService>(MessagingService);
    expect(service).toBeDefined();
  });
});
