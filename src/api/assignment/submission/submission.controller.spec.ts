import { Test, TestingModule } from "@nestjs/testing";
import { WINSTON_MODULE_PROVIDER } from "nest-winston";
import { Logger } from "winston";
import { PrismaService } from "../../../prisma.service";
import { LlmService } from "../../llm/llm.service";
import { QuestionService } from "../question/question.service";
import { SubmissionController } from "./submission.controller";
import { SubmissionService } from "./submission.service";

describe("SubmissionController", () => {
  let controller: SubmissionController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [SubmissionController],
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

    controller = module.get<SubmissionController>(SubmissionController);
  });

  it("should be defined", () => {
    expect(controller).toBeDefined();
  });
});
