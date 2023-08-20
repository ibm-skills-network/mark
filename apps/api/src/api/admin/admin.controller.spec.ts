import { Test, TestingModule } from "@nestjs/testing";
import { JwtConfigService } from "../../auth/jwt/jwt.config.service";
import { PrismaService } from "../../prisma.service";
import { AdminController } from "./admin.controller";
import { AdminService } from "./admin.service";

describe("AdminController", () => {
  let controller: AdminController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [AdminController],
      providers: [AdminService, JwtConfigService, PrismaService],
    }).compile();

    controller = module.get<AdminController>(AdminController);
  });

  it("should be defined", () => {
    expect(controller).toBeDefined();
  });
});
