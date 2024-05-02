import { Test, TestingModule } from "@nestjs/testing";
import { WINSTON_MODULE_PROVIDER } from "nest-winston";
import { Logger } from "winston";
import { PrismaService } from "../../prisma.service";
import { LlmService } from "../llm/llm.service";
import { AssignmentService } from "./assignment.service";

describe("AssignmentService", () => {
  let service: AssignmentService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AssignmentService,
        PrismaService,
        LlmService,
        {
          provide: WINSTON_MODULE_PROVIDER,
          useValue: {
            child: jest.fn().mockReturnValue({}), // assuming 'child' method returns an object in real implementation.
          } as Partial<Logger>, // Partial<Logger> makes Logger optional, so that it's not necessary to implement every method of Logger.
        },
      ],
    }).compile();

    service = module.get<AssignmentService>(AssignmentService);
  });

  it("should be defined", () => {
    expect(service).toBeDefined();
  });
});
