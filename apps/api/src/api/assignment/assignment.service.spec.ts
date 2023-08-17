import { Test, TestingModule } from "@nestjs/testing";
import { PrismaService } from "../../prisma.service";
import { AssignmentService } from "./assignment.service";

describe("AssignmentService", () => {
  let service: AssignmentService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [AssignmentService, PrismaService],
    }).compile();

    service = module.get<AssignmentService>(AssignmentService);
  });

  it("should be defined", () => {
    expect(service).toBeDefined();
  });
});
