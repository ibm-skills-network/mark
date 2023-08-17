import { Test, TestingModule } from "@nestjs/testing";
import { WINSTON_MODULE_PROVIDER } from "nest-winston";
import { Logger } from "winston";
import { PrismaService } from "../../../prisma.service";
import { LlmService } from "../../llm/llm.service";
import { QuestionService } from "../question/question.service";
import { SubmissionService } from "./submission.service";

describe("SubmissionService", () => {
  let service: SubmissionService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SubmissionService,
        PrismaService,
        LlmService,
        QuestionService,
        {
          provide: WINSTON_MODULE_PROVIDER,
          useValue: {
            child: jest.fn().mockReturnValue({}), // assuming 'child' method returns an object in real implementation.
          } as Partial<Logger>, // Partial<Logger> makes Logger optional, so that it's not necessary to implement every method of Logger.
        },
      ],
    }).compile();

    service = module.get<SubmissionService>(SubmissionService);
  });

  it("should be defined", () => {
    expect(service).toBeDefined();
  });
});
