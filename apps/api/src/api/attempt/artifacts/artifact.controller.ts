import {
  Controller,
  Get,
  Param,
  ParseIntPipe,
  ParseUUIDPipe,
  Post,
  Req,
  Res,
  SetMetadata,
  UseGuards,
} from "@nestjs/common";
import { Response } from "express";
import { Roles } from "../../../auth/role/roles.global.guard";
import {
  UserRole,
  UserSessionRequest,
} from "../../../auth/interfaces/user.session.interface";
import { AssignmentAttemptAccessControlGuard } from "../../assignment/attempt/guards/assignment.attempt.access.control.guard";
import { ArtifactService } from "./artifact.service";

@Controller({
  path: "assignments/:assignmentId/attempts/:attemptId/sources/:sourceId/artifacts",
  version: "2",
})
@SetMetadata("attemptSnapshotContract", true)
@Roles(UserRole.LEARNER)
@UseGuards(AssignmentAttemptAccessControlGuard)
export class ArtifactController {
  constructor(private readonly artifacts: ArtifactService) {}

  @Post()
  request(
    @Param("assignmentId", ParseIntPipe) assignmentId: number,
    @Param("attemptId", ParseIntPipe) attemptId: number,
    @Param("sourceId", ParseUUIDPipe) sourceId: string,
    @Req() request: UserSessionRequest,
  ) {
    return this.artifacts.request(
      attemptId,
      assignmentId,
      request.userSession.userId,
      sourceId,
    );
  }

  @Get()
  read(
    @Param("assignmentId", ParseIntPipe) assignmentId: number,
    @Param("attemptId", ParseIntPipe) attemptId: number,
    @Param("sourceId", ParseUUIDPipe) sourceId: string,
    @Req() request: UserSessionRequest,
  ) {
    return this.artifacts.read(
      attemptId,
      assignmentId,
      request.userSession.userId,
      sourceId,
    );
  }

  @Get(":artifactId/resources/:resourceId")
  async resource(
    @Param("assignmentId", ParseIntPipe) assignmentId: number,
    @Param("attemptId", ParseIntPipe) attemptId: number,
    @Param("sourceId", ParseUUIDPipe) sourceId: string,
    @Param("artifactId", ParseUUIDPipe) artifactId: string,
    @Param("resourceId") resourceId: string,
    @Req() request: UserSessionRequest,
    @Res() response: Response,
  ) {
    const resource = await this.artifacts.resource(
      attemptId,
      assignmentId,
      request.userSession.userId,
      sourceId,
      artifactId,
      resourceId,
    );
    response.setHeader("Content-Type", resource.mediaType);
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.setHeader("Content-Disposition", "attachment");
    response.setHeader("Cache-Control", "private, no-store");
    response.send(resource.bytes);
  }
}
