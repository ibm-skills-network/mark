/* eslint-disable */
import { Test, TestingModule } from "@nestjs/testing";
import { AppModule } from "./app.module";
import { AppService } from "./app.service";
import { LoggerMiddleware } from "./logger/logger.middleware";

describe("AppModule", () => {
  let module: TestingModule;

  beforeEach(async () => {
    module = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
  });

  it("should be defined", () => {
    expect(module).toBeDefined();
  });

  it("should have AppService defined", () => {
    const appService = module.get<AppService>(AppService);
    expect(appService).toBeDefined();
  });

  it("should configure LoggerMiddleware for all routes", () => {
    const appModule = module.get<AppModule>(AppModule);
    expect(appModule).toBeDefined();
    expect(appModule.configure).toBeDefined();
  });

  it("should apply middleware using configure method", () => {
    const appModule = module.get<AppModule>(AppModule);
    const mockConsumer = {
      apply: jest.fn().mockReturnThis(),
      forRoutes: jest.fn().mockReturnThis(),
    };

    appModule.configure(mockConsumer as any);

    expect(mockConsumer.apply).toHaveBeenCalledWith(LoggerMiddleware);
    expect(mockConsumer.forRoutes).toHaveBeenCalled();
  });
});
