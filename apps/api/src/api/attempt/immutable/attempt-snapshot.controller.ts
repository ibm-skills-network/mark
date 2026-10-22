import { createAttemptSchema } from "backend-contracts";
import {
  Body,
  BadRequestException,
  SetMetadata,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Put,
  Req,
  UseGuards,
} from "@nestjs/common";
import { Roles } from "../../../auth/role/roles.global.guard";
import {
  UserRole,
  UserSessionRequest,
} from "../../../auth/interfaces/user.session.interface";
import { AssignmentAttemptAccessControlGuard } from "../../assignment/attempt/guards/assignment.attempt.access.control.guard";
import { AttemptSubmissionService } from "../services/attempt-submission.service";
import { AttemptSnapshotService } from "./attempt-snapshot.service";

@Controller({ path: "assignments/:assignmentId/attempts", version: "2" })
@SetMetadata("attemptSnapshotContract", true)
@Roles(UserRole.LEARNER)
@UseGuards(AssignmentAttemptAccessControlGuard)
export class AttemptSnapshotController {
  constructor(
    private readonly snapshots: AttemptSnapshotService,
    private readonly submissions: AttemptSubmissionService,
  ) {}

  @Post("snapshot")
  create(
    @Param("assignmentId", ParseIntPipe) assignmentId: number,
    @Req() request: UserSessionRequest,
    @Body() body: unknown,
  ) {
    const parsed = createAttemptSchema.safeParse(body);
    if (!parsed.success)
      throw new BadRequestException("Creation requires a UUID operationId");
    return this.submissions.createAssignmentAttempt(
      assignmentId,
      request.userSession,
      true,
      parsed.data.operationId,
    );
  }

  @Get(":attemptId/snapshot")
  read(
    @Param("assignmentId", ParseIntPipe) assignmentId: number,
    @Param("attemptId", ParseIntPipe) attemptId: number,
    @Req() request: UserSessionRequest,
  ) {
    return this.snapshots.read(
      attemptId,
      assignmentId,
      request.userSession.userId,
    );
  }

  @Put(":attemptId/draft")
  save(
    @Param("assignmentId", ParseIntPipe) assignmentId: number,
    @Param("attemptId", ParseIntPipe) attemptId: number,
    @Req() request: UserSessionRequest,
    @Body() body: unknown,
  ) {
    return this.snapshots.save(
      attemptId,
      assignmentId,
      request.userSession.userId,
      body,
    );
  }

  @Post(":attemptId/sources")
  bindSource(
    @Param("assignmentId", ParseIntPipe) assignmentId: number,
    @Param("attemptId", ParseIntPipe) attemptId: number,
    @Req() request: UserSessionRequest,
    @Body("uploadId") uploadId: string,
  ) {
    return this.snapshots.bindSource(
      attemptId,
      assignmentId,
      request.userSession.userId,
      uploadId,
    );
  }

  @Post(":attemptId/submissions")
  async submit(
    @Param("assignmentId", ParseIntPipe) assignmentId: number,
    @Param("attemptId", ParseIntPipe) attemptId: number,
    @Req() request: UserSessionRequest,
    @Body() body: unknown,
  ) {
    // This API currently admits only deterministic CHOICE-01 definitions.
    // Future AI cohorts must check the kill switch against their pinned definition.
    const submission = await this.snapshots.submit(
      attemptId,
      assignmentId,
      request.userSession.userId,
      body,
    );
    // Retrying after a process failure resumes grading the same immutable snapshot.
    // Durable autonomous dispatch and reconciliation are Part 06.
    const result = await this.submissions.updateAssignmentAttempt(
      attemptId,
      assignmentId,
      { submitted: true, responsesForQuestions: [], language: "en" },
      typeof request.cookies?.authentication === "string"
        ? request.cookies.authentication
        : "",
      request.userSession.gradingCallbackRequired ?? false,
      request,
    );
    return {
      submissionId: submission.id,
      draftRevision: submission.draftRevision,
      result,
    };
  }
}
