/* eslint-disable */
import { Test, TestingModule } from "@nestjs/testing";
import { HealthController } from "./health.controller";
import { HealthModule } from "./health.module";
import { HealthService } from "./health.service";

describe("HealthModule", () => {
  let module: TestingModule;

  beforeEach(async () => {
    module = await Test.createTestingModule({
      imports: [HealthModule],
    }).compile();
  });

  it("should be defined", () => {
    expect(module).toBeDefined();
  });

  it("should have HealthController defined", () => {
    const controller = module.get<HealthController>(HealthController);
    expect(controller).toBeDefined();
  });

  it("should have HealthService defined", () => {
    const service = module.get<HealthService>(HealthService);
    expect(service).toBeDefined();
  });
});
