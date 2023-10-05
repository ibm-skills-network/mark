import {
  All,
  Controller,
  Get,
  Injectable,
  Req,
  Res,
  UseGuards,
} from "@nestjs/common";
import { ApiBadRequestResponse, ApiOperation, ApiTags } from "@nestjs/swagger";
import { Response } from "express";
import { UserSessionRequest } from "../auth/interfaces/user.session.interface";
import { DynamicJwtBearerTokenAuthGuard } from "../auth/jwt/bearer-token-based/dynamic.jwt.bearer.token.auth.guard";
import { DynamicJwtCookieAuthGuard } from "../auth/jwt/cookie-based/dynamic.jwt.cookie.auth.guard";
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
  @UseGuards(DynamicJwtBearerTokenAuthGuard)
  @ApiOperation({ summary: "Handle CRUD operations for LTI Consumers" })
  @ApiBadRequestResponse({ description: "Bad request" })
  async handleLtiOauthConsumers(
    @Req() request: UserSessionRequest,
    @Res() response: Response
  ) {
    const apiResponse = await this.apiService.forwardRequestToDownstreamService(
      DownstreamService.LTI_CREDENTIAL_MANAGER,
      request
    );
    return response.status(apiResponse.status).send(apiResponse.data);
  }

  @All("/admin/*")
  @UseGuards(DynamicJwtBearerTokenAuthGuard)
  @ApiOperation({ summary: "Handle API requests for the Mark Admin API" })
  @ApiBadRequestResponse({ description: "Bad request" })
  async handleAdminApiRequests(
    @Req() request: UserSessionRequest,
    @Res() response: Response
  ) {
    const apiResponse = await this.apiService.forwardRequestToDownstreamService(
      DownstreamService.MARK_API,
      request
    );
    return response.status(apiResponse.status).send(apiResponse.data);
  }

  @All("/*")
  @UseGuards(DynamicJwtCookieAuthGuard)
  @ApiOperation({ summary: "Handle API requests for the Mark API" })
  @ApiBadRequestResponse({ description: "Bad request" })
  async handleApiRequests(
    @Req() request: UserSessionRequest,
    @Res() response: Response
  ) {
    const apiResponse = await this.apiService.forwardRequestToDownstreamService(
      DownstreamService.MARK_API,
      request
    );
    return response.status(apiResponse.status).send(apiResponse.data);
  }
}
