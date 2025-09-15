import { Test, TestingModule } from "@nestjs/testing";
import { PrismaService } from "../../prisma.service";
import { LLM_PRICING_SERVICE } from "../llm/llm.constants";
import { AdminService } from "./admin.service";

describe("AdminService", () => {
  let service: AdminService;

  beforeEach(async () => {
    const mockLlmPricingService = {
      calculateCost: jest.fn().mockReturnValue(0.01),
      getTokenCount: jest.fn().mockReturnValue(100),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AdminService,
        PrismaService,
        { provide: LLM_PRICING_SERVICE, useValue: mockLlmPricingService },
      ],
    }).compile();

    service = module.get<AdminService>(AdminService);
  });

  it("should be defined", () => {
    expect(service).toBeDefined();
  });
});
