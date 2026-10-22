import {
  BadRequestException,
  Body,
  Controller,
  Param,
  ParseIntPipe,
  Post,
  Req,
  SetMetadata,
  UseGuards,
} from "@nestjs/common";
import { z } from "zod";
import { Roles } from "../../../auth/role/roles.global.guard";
import {
  UserRole,
  UserSessionRequest,
} from "../../../auth/interfaces/user.session.interface";
import { AssignmentAttemptAccessControlGuard } from "../../assignment/attempt/guards/assignment.attempt.access.control.guard";
import { ArtifactUrlService } from "./artifact-url.service";

@Controller({
  path: "assignments/:assignmentId/attempts/:attemptId/sources/url",
  version: "2",
})
@SetMetadata("attemptSnapshotContract", true)
@Roles(UserRole.LEARNER)
@UseGuards(AssignmentAttemptAccessControlGuard)
export class ArtifactUrlController {
  constructor(private readonly urls: ArtifactUrlService) {}
  @Post()
  capture(
    @Param("assignmentId", ParseIntPipe) assignmentId: number,
    @Param("attemptId", ParseIntPipe) attemptId: number,
    @Req() request: UserSessionRequest,
    @Body() body: unknown,
  ) {
    const input = z
      .object({ url: z.string().url().max(8192) })
      .strict()
      .safeParse(body);
    if (!input.success)
      throw new BadRequestException("Invalid URL capture request.");
    return this.urls.capture(
      attemptId,
      assignmentId,
      request.userSession.userId,
      input.data.url,
    );
  }
}
