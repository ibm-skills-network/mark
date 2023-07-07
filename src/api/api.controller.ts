import { Controller, Get, Version } from "@nestjs/common";
import { ApiService } from "./api.service";

@Controller()
export class ApiController {
  constructor(private readonly apiService: ApiService) {}

  // TODO(user): you can use this if you need backwards compatibility with an unversioned API
  // otherwise, remove it
  // @Version(["1", VERSION_NEUTRAL])
  @Version("1")
  @Get("info")
  rootV1() {
    return this.apiService.rootV1();
  }

  // TODO(user): remove if you like -- this is just an example of how to introduce a v2 api
  // @Version("2")
  // @All("*")
  // @ApiOperation({ summary: "/api/v2 is not implemented" })
  // @ApiNotImplementedResponse()
  // @HttpCode(501)
  // rootV2() {
  //   return this.apiService.rootV2();
  // }
}
