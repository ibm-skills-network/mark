import { All, Controller, Get, Injectable, Req, Res } from "@nestjs/common";
import { ApiBadRequestResponse, ApiOperation, ApiTags } from "@nestjs/swagger";
import { ApiService } from "./api.service";

export enum DownstreamService {
  MARK_API,
  LTI_CREDENTIAL_MANAGER,
}

@ApiTags(
  "Api (All the endpoints use a JWT Cookie named 'authentication' for authorization)"
)
@Injectable()
@Controller({
  version: "1",
})
export class ApiController {
  constructor(private readonly apiService: ApiService) {}

  @Get("info")
  rootV1() {
    return this.apiService.rootV1();
  }

  @All(["oauth_consumers", "oauth_consumers/*"])
  @ApiOperation({ summary: "Handle CRUD operations for LTI Consumers" })
  @ApiBadRequestResponse({ description: "Bad request" })
  async handleLtiOauthConsumers(@Req() request: Request) {
    return this.apiService.forwardRequestToDownstreamService(
      DownstreamService.LTI_CREDENTIAL_MANAGER,
      request
    );
  }

  @All("/*")
  @ApiOperation({ summary: "Handle API requests for the Mark API" })
  @ApiBadRequestResponse({ description: "Bad request" })
  async handleApiRequests(@Req() request: Request) {
    return this.apiService.forwardRequestToDownstreamService(
      DownstreamService.MARK_API,
      request
    );
  }
}
