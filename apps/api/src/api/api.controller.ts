import * as fs from "node:fs";
import * as path from "node:path";
import { Controller, Get, Req } from "@nestjs/common";
import { ApiOperation, ApiResponse } from "@nestjs/swagger";
import {
  ClientUserSession,
  UserSessionRequest,
} from "src/auth/interfaces/user.session.interface";
import { ApiService } from "./api.service";

@Controller({
  version: "1",
})
export class ApiController {
  constructor(private readonly apiService: ApiService) {}

  @Get("info")
  rootV1() {
    return this.apiService.rootV1();
  }

  @Get("assets/example-schema")
  exampleSchema() {
    /* eslint-disable unicorn/prefer-module */
    const filePath = path.join(
      __dirname,
      "..",
      "..",
      "assets",
      "schema",
      "assignment-example.json",
    );
    const fileContent = fs.readFileSync(filePath, "utf8");
    const formattedJson = JSON.stringify(JSON.parse(fileContent), undefined, 2);
    return `<pre>${formattedJson}</pre>`;
    /* eslint-enable unicorn/prefer-module */
  }

  @Get("user-session")
  @ApiOperation({
    summary:
      "Get user session information - needs a user-session header (injected using the API Gateway)",
  })
  @ApiResponse({
    status: 200,
    description: "The user session information was successfully retrieved.",
  })
  getUserSession(@Req() request: UserSessionRequest): ClientUserSession {
    const userSession = request.userSession;
    return {
      userId: userSession.userId,
      role: userSession.role,
      assignmentId: userSession.assignmentId,
      returnUrl: userSession.returnUrl,
      launch_presentation_locale: userSession.launch_presentation_locale,
    };
  }
}
