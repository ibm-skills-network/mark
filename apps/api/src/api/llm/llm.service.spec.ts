import { Test, TestingModule } from "@nestjs/testing";
import { WINSTON_MODULE_PROVIDER } from "nest-winston";
import { PrismaService } from "src/prisma.service";
import { Logger } from "winston";
import { LlmService } from "./llm.service";

describe("LlmService", () => {
  let service: LlmService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LlmService,
        {
          provide: WINSTON_MODULE_PROVIDER,
          useValue: {
            child: jest.fn().mockReturnValue({}), // Mock implementation for winston child logger
          } as Partial<Logger>,
        },
        {
          provide: PrismaService,
          useValue: {}, // Mock PrismaService or replace with an actual mock implementation if needed
        },
      ],
    }).compile();

    service = module.get<LlmService>(LlmService);
  });

  it("should be defined", () => {
    expect(service).toBeDefined();
  });
});
