import { Reflector } from "@nestjs/core";
import { Test, TestingModule } from "@nestjs/testing";
import { WINSTON_MODULE_PROVIDER } from "nest-winston";
import { Logger } from "winston";
import { PrismaService } from "../../prisma.service";
import { JobStatusService } from "../Job/job-status.service";
import { LlmService } from "../llm/llm.service";
import { AssignmentController } from "./assignment.controller";
import { AssignmentService } from "./assignment.service";

describe("AssignmentController", () => {
  let controller: AssignmentController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [AssignmentController],
      providers: [
        AssignmentService,
        PrismaService,
        LlmService,
        JobStatusService,
        Reflector,
        {
          provide: WINSTON_MODULE_PROVIDER,
          useValue: {
            child: jest.fn().mockReturnValue({}), // assuming 'child' method returns an object in real implementation.
          } as Partial<Logger>, // Partial<Logger> makes Logger optional, so that it's not necessary to implement every method of Logger.
        },
      ],
    }).compile();

    controller = module.get<AssignmentController>(AssignmentController);
  });

  it("should be defined", () => {
    expect(controller).toBeDefined();
  });
});
