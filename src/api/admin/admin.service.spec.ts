import { Test, TestingModule } from "@nestjs/testing";
import { JwtConfigService } from "../../auth/jwt/jwt.config.service";
import { AdminService } from "./admin.service";

describe("AdminService", () => {
  let service: AdminService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [AdminService, JwtConfigService],
    }).compile();

    service = module.get<AdminService>(AdminService);
  });

  it("should be defined", () => {
    expect(service).toBeDefined();
  });
});
