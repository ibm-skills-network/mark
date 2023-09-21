import { HttpModule } from "@nestjs/axios";
import { Test, TestingModule } from "@nestjs/testing";
import { WINSTON_MODULE_PROVIDER } from "nest-winston";
import { Logger } from "winston";
import { PrismaService } from "../../../prisma.service";
import { LlmService } from "../../llm/llm.service";
import { AssignmentService } from "../assignment.service";
import { QuestionService } from "../question/question.service";
import { AttemptController } from "./attempt.controller";
import { AttemptService } from "./attempt.service";

describe("AttemptController", () => {
  let controller: AttemptController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [AttemptController],
      providers: [
        AttemptService,
        PrismaService,
        LlmService,
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

    controller = module.get<AttemptController>(AttemptController);
  });

  it("should be defined", () => {
    expect(controller).toBeDefined();
  });
});
