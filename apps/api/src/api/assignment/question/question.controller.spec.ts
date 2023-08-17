import { Test, TestingModule } from "@nestjs/testing";
import { WINSTON_MODULE_PROVIDER } from "nest-winston";
import { Logger } from "winston";
import { PrismaService } from "../../../prisma.service";
import { LlmService } from "../../llm/llm.service";
import { QuestionController } from "./question.controller";
import { QuestionService } from "./question.service";

describe("QuestionController", () => {
  let controller: QuestionController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [QuestionController],
      providers: [
        QuestionService,
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

    controller = module.get<QuestionController>(QuestionController);
  });

  it("should be defined", () => {
    expect(controller).toBeDefined();
  });
});
