import { HttpModule } from "@nestjs/axios";
import { Test, TestingModule } from "@nestjs/testing";
import { WINSTON_MODULE_PROVIDER } from "nest-winston";
import { JobStatusService } from "src/api/Job/job-status.service";
import { Logger } from "winston";
import { PrismaService } from "../../../prisma.service";
import { LlmService } from "../../llm/llm.service";
import { AssignmentService } from "../assignment.service";
import { QuestionService } from "../question/question.service";
import { AttemptService } from "./attempt.service";

describe("AttemptService", () => {
  let service: AttemptService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AttemptService,
        PrismaService,
        LlmService,
        JobStatusService,
        QuestionService,
        AssignmentService,
        {
          provide: WINSTON_MODULE_PROVIDER,
          useValue: {
            child: jest.fn().mockReturnValue({}), // assuming 'child' method returns an object in real implementation.
          } as Partial<Logger>, // Partial<Logger> makes Logger optional, so that it's not necessary to implement every method of Logger.
        },
      ],
      imports: [HttpModule],
    }).compile();

    service = module.get<AttemptService>(AttemptService);
  });

  it("should be defined", () => {
    expect(service).toBeDefined();
  });
});
