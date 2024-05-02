import { TerminusModule } from "@nestjs/terminus";
import { Test, TestingModule } from "@nestjs/testing";
import { PrismaService } from "../prisma.service";
import { HealthService } from "./health.service";

describe("HealthService", () => {
  let service: HealthService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [HealthService, PrismaService],
      imports: [TerminusModule],
    }).compile();

    service = module.get<HealthService>(HealthService);
  });

  it("should be defined", () => {
    expect(service).toBeDefined();
  });
});
