import { Controller, Get, Version } from "@nestjs/common";
import { ApiService } from "./api.service";

@Controller()
export class ApiController {
  constructor(private readonly apiService: ApiService) {}

  @Version("1")
  @Get("info")
  rootV1() {
    return this.apiService.rootV1();
  }
}
