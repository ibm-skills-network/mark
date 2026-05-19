/* eslint-disable @typescript-eslint/require-await */
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Injectable,
  Param,
  Patch,
  Post,
  Put,
  Req,
  UsePipes,
  ValidationPipe,
} from "@nestjs/common";
import {
  ApiBearerAuth,
  ApiBody,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from "@nestjs/swagger";
import { Assignment } from "@prisma/client";
import { WINSTON_MODULE_PROVIDER } from "nest-winston";
import { Logger } from "winston";
import { AdminRepository } from "./admin.repository";
import { AdminService } from "./admin.service";
import { QuestionGenerationPayload } from "../assignment/dto/post.assignment.request.dto";
import {
  CompleteAssignmentFileDto,
  InitiateAssignmentFilesDto,
  InitiateAssignmentFilesResponseDto,
} from "../assignment/v2/dtos/assignment-file-upload.dto";
import { AdminAddAssignmentToGroupResponseDto } from "./dto/assignment/add.assignment.to.group.response.dto";
import { AdminBaseAssignmentResponseDto } from "./dto/assignment/base.assignment.response.dto";
import { AdminAssignmentCloneRequestDto } from "./dto/assignment/clone.assignment.request.dto";
import {
  AdminCreateAssignmentRequestDto,
  AdminReplaceAssignmentRequestDto,
} from "./dto/assignment/create.replace.assignment.request.dto";
import { AdminGetAssignmentResponseDto } from "./dto/assignment/get.assignment.response.dto";
import { AdminUpdateAssignmentRequestDto } from "./dto/assignment/update.assignment.request.dto";
import { AdminAddContentToAssignmentRequestDto } from "./dto/assignment/add.content.to.assignment.request.dto";
import {
  UserSession,
  UserSessionRequest,
} from "../../auth/interfaces/user.session.interface";

@ApiTags("Admin")
@UsePipes(
  new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
  }),
)
@ApiBearerAuth()
@Injectable()
@Controller({
  path: "admin",
  version: "1",
})
export class AdminController {
  private readonly logger: Logger;

  constructor(
    private adminService: AdminService,
    private adminRepository: AdminRepository,
    @Inject(WINSTON_MODULE_PROVIDER) parentLogger: Logger,
  ) {
    this.logger = parentLogger.child({ context: AdminController.name });
  }

  @Post("assignments/clone/:id")
  @ApiOperation({
    summary: "Clone an assignment and associates it with the provided groupId",
  })
  @ApiParam({ name: "id", required: true })
  @ApiResponse({ status: 200, type: AdminBaseAssignmentResponseDto })
  @ApiResponse({ status: 403 })
  cloneAssignment(
    @Param("id") assignmentId: number,
    @Body() assignmentCloneRequestDto: AdminAssignmentCloneRequestDto,
  ): Promise<AdminBaseAssignmentResponseDto> {
    return this.adminService.cloneAssignment(
      Number(assignmentId),
      assignmentCloneRequestDto.groupId,
    );
  }

  @Post("assignments/:assignmentId/groups/:groupId")
  @ApiOperation({ summary: "Associate an assignment with a group" })
  @ApiParam({ name: "id", required: true })
  @ApiResponse({ status: 200, type: AdminAddAssignmentToGroupResponseDto })
  @ApiResponse({ status: 403 })
  addAssignmentToGroup(
    @Param("assignmentId") assignmentId: number,
    @Param("groupId") groupId: string,
  ): Promise<AdminAddAssignmentToGroupResponseDto> {
    return this.adminService.addAssignmentToGroup(
      Number(assignmentId),
      groupId,
    );
  }
  @Get("/assignments")
  @ApiOperation({ summary: "Get all assignments" })
  @ApiResponse({ status: 200, type: [AdminBaseAssignmentResponseDto] })
  @ApiResponse({ status: 403 })
  getAssignments(): Promise<Assignment[]> {
    return this.adminRepository.findAllAssignments();
  }
  @Post("/assignments")
  @ApiOperation({ summary: "Create an assignment" })
  @ApiBody({ type: AdminCreateAssignmentRequestDto })
  @ApiResponse({ status: 201, type: AdminBaseAssignmentResponseDto })
  @ApiResponse({ status: 403 })
  createAssignment(
    @Body() createAssignmentRequestDto: AdminCreateAssignmentRequestDto,
  ): Promise<AdminBaseAssignmentResponseDto> {
    return this.adminService.createAssignment(createAssignmentRequestDto);
  }

  @Get("/assignments/:id")
  @ApiOperation({ summary: "Get an assignment" })
  @ApiParam({ name: "id", required: true })
  @ApiResponse({ status: 201, type: AdminBaseAssignmentResponseDto })
  @ApiResponse({ status: 403 })
  async getAssignment(
    @Param("id") id: number,
  ): Promise<AdminGetAssignmentResponseDto> {
    return this.adminService.getAssignment(Number(id));
  }

  @Get("assignments/:id/files")
  @ApiOperation({ summary: "List files for an assignment" })
  @ApiParam({ name: "id", required: true, description: "Assignment ID" })
  @ApiResponse({
    status: 200,
    description: "List of files associated with the assignment",
  })
  @ApiResponse({ status: 404, description: "Assignment not found" })
  getAssignmentFiles(@Param("id") id: number) {
    return this.adminService.getAssignmentFiles(Number(id));
  }

  @Post("assignments/:id/files/initiate")
  @ApiOperation({
    summary:
      "Initiate multipart uploads for assignment files (returns presigned part URLs)",
  })
  @ApiParam({ name: "id", required: true, description: "Assignment ID" })
  @ApiBody({ type: InitiateAssignmentFilesDto })
  @ApiResponse({
    status: 201,
    type: InitiateAssignmentFilesResponseDto,
    description:
      "Per-file uploadId, key, bucket, part size and presigned part URLs",
  })
  @ApiResponse({ status: 404, description: "Assignment not found" })
  initiateAssignmentFileUploads(
    @Param("id") id: number,
    @Body(new ValidationPipe({ transform: true }))
    dto: InitiateAssignmentFilesDto,
    @Req() request: UserSessionRequest,
  ): Promise<InitiateAssignmentFilesResponseDto> {
    return this.adminService.initiateAssignmentFileUploads(
      Number(id),
      dto,
      this.getActorUserId(request),
    );
  }

  @Post("assignments/:id/files/:fileId/complete")
  @ApiOperation({
    summary:
      "Complete a multipart upload for an assignment file and extract content",
  })
  @ApiParam({ name: "id", required: true, description: "Assignment ID" })
  @ApiParam({ name: "fileId", required: true, description: "File ID" })
  @ApiBody({ type: CompleteAssignmentFileDto })
  @ApiResponse({
    status: 201,
    description:
      "File record updated to READY (or FAILED extraction) and extracted content persisted",
  })
  @ApiResponse({ status: 404, description: "Assignment or file not found" })
  completeAssignmentFileUpload(
    @Param("id") id: number,
    @Param("fileId") fileId: number,
    @Body(new ValidationPipe({ transform: true }))
    dto: CompleteAssignmentFileDto,
  ) {
    return this.adminService.completeAssignmentFileUpload(
      Number(id),
      Number(fileId),
      dto,
    );
  }

  @Post("assignments/:id/files/:fileId/abort")
  @HttpCode(204)
  @ApiOperation({
    summary:
      "Abort an in-progress multipart upload and remove the placeholder row",
  })
  @ApiParam({ name: "id", required: true, description: "Assignment ID" })
  @ApiParam({ name: "fileId", required: true, description: "File ID" })
  @ApiResponse({ status: 204, description: "Upload aborted" })
  @ApiResponse({ status: 404, description: "Assignment or file not found" })
  abortAssignmentFileUpload(
    @Param("id") id: number,
    @Param("fileId") fileId: number,
  ): Promise<void> {
    return this.adminService.abortAssignmentFileUpload(
      Number(id),
      Number(fileId),
    );
  }

  @Delete("assignments/:id/files/:fileId")
  @HttpCode(204)
  @ApiOperation({ summary: "Delete a file from an assignment" })
  @ApiParam({ name: "id", required: true, description: "Assignment ID" })
  @ApiParam({ name: "fileId", required: true, description: "File ID" })
  @ApiResponse({ status: 204, description: "File deleted successfully" })
  @ApiResponse({ status: 404, description: "Assignment or file not found" })
  deleteAssignmentFile(
    @Param("id") id: number,
    @Param("fileId") fileId: number,
  ): Promise<void> {
    return this.adminService.deleteAssignmentFile(Number(id), Number(fileId));
  }

  @Post("assignments/:id/generate-questions")
  @ApiOperation({ summary: "Generate questions for the assignment" })
  @ApiParam({
    name: "id",
    required: true,
    description: "Assignment ID",
  })
  @ApiBody({
    description: "Question generation configuration",
    type: Object,
  })
  @ApiResponse({
    status: 201,
    description: "Question generation started",
    schema: {
      type: "object",
      properties: {
        message: { type: "string", description: "Status message" },
        jobId: { type: "string", description: "Job ID for tracking progress" },
      },
    },
  })
  @ApiResponse({ status: 404, description: "Assignment not found" })
  generateQuestions(
    @Param("id") id: number,
    @Body(new ValidationPipe({ transform: true }))
    payload: QuestionGenerationPayload,
    @Req() request: UserSessionRequest,
  ): Promise<{ message: string; jobId: string }> {
    return this.adminService.generateQuestions(
      Number(id),
      payload,
      this.getActorUserId(request),
    );
  }

  @Get("assignments/jobs/:jobId/status")
  @ApiOperation({
    summary: "Get job status for admin-triggered question generation",
  })
  @ApiParam({
    name: "jobId",
    required: true,
    description: "Job ID",
  })
  @ApiResponse({
    status: 200,
    schema: {
      type: "object",
      properties: {
        status: { type: "string", description: "Current job status" },
        progress: { type: "string", description: "Progress description" },
        questions: {
          type: "array",
          items: { type: "object" },
          description: "Generated questions (only when status is Completed)",
        },
      },
    },
  })
  @ApiResponse({ status: 404, description: "Job not found" })
  getQuestionGenerationJobStatus(@Param("jobId") jobId: string) {
    return this.adminService.getQuestionGenerationJobStatus(jobId);
  }

  @Put("/assignments/:id")
  @ApiOperation({ summary: "Replace an assignment" })
  @ApiParam({ name: "id", required: true })
  @ApiBody({ type: AdminReplaceAssignmentRequestDto })
  @ApiResponse({ status: 200, type: AdminBaseAssignmentResponseDto })
  @ApiResponse({ status: 403 })
  replaceAssignment(
    @Param("id") id: number,
    @Body() replaceAssignmentRequestDto: AdminReplaceAssignmentRequestDto,
  ): Promise<AdminBaseAssignmentResponseDto> {
    return this.adminService.replaceAssignment(
      Number(id),
      replaceAssignmentRequestDto,
    );
  }

  @Patch("/assignments/:id")
  @ApiOperation({ summary: "Update an assignment" })
  @ApiParam({ name: "id", required: true })
  @ApiBody({ type: AdminUpdateAssignmentRequestDto })
  @ApiResponse({ status: 200, type: AdminBaseAssignmentResponseDto })
  @ApiResponse({ status: 403 })
  updateAssignment(
    @Param("id") id: number,
    @Body() updateAssignmentRequestDto: AdminUpdateAssignmentRequestDto,
  ): Promise<AdminBaseAssignmentResponseDto> {
    return this.adminService.updateAssignment(
      Number(id),
      updateAssignmentRequestDto,
    );
  }

  @Delete("assignments/:id")
  @ApiOperation({ summary: "Delete an assignment" })
  @ApiParam({ name: "id", required: true })
  @ApiResponse({ status: 200, type: AdminBaseAssignmentResponseDto })
  @ApiResponse({ status: 403 })
  deleteAssignment(
    @Param("id") id: number,
  ): Promise<AdminBaseAssignmentResponseDto> {
    return this.adminService.removeAssignment(Number(id));
  }

  @Post("assignments/:id/content")
  @ApiOperation({
    summary: "Add content to an existing assignment",
    description:
      "This endpoint allows external services to populate an empty assignment with assignment details, configuration, and questions. Also creates version 0.0.1 and publishes the assignment.",
  })
  @ApiParam({
    name: "id",
    required: true,
    description: "The ID of the assignment to add content to",
  })
  @ApiBody({ type: AdminAddContentToAssignmentRequestDto })
  @ApiResponse({ status: 200, type: AdminBaseAssignmentResponseDto })
  @ApiResponse({ status: 403 })
  @ApiResponse({ status: 404, description: "Assignment not found" })
  addContentToAssignment(
    @Param("id") id: number,
    @Body() addContentRequestDto: AdminAddContentToAssignmentRequestDto,
    @Req() request: UserSessionRequest,
  ): Promise<AdminBaseAssignmentResponseDto> {
    return this.adminService.addContentToAssignment(
      Number(id),
      addContentRequestDto,
      this.getActorUserId(request),
    );
  }

  private getActorUserId(request: UserSessionRequest): string {
    const userId = request.userSession?.userId;
    if (typeof userId === "string" && userId.trim().length > 0) {
      return userId;
    }

    const forwardedSession = this.getForwardedUserSession(request);
    const forwardedUserId = forwardedSession?.userId;
    if (
      typeof forwardedUserId === "string" &&
      forwardedUserId.trim().length > 0
    ) {
      return forwardedUserId;
    }

    return "admin-api";
  }

  private getForwardedUserSession(
    request: UserSessionRequest,
  ): Partial<UserSession> | undefined {
    const forwardedHeader = request.headers["user-session"];
    const headerValue = Array.isArray(forwardedHeader)
      ? forwardedHeader[0]
      : forwardedHeader;

    if (typeof headerValue !== "string" || headerValue.length === 0) {
      return undefined;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(headerValue);
    } catch (parseError) {
      this.logger.warn("forwarded user-session header parse failed", {
        method: request.method,
        url: request.originalUrl,
        request_id:
          request.get("akamai-grn") ?? request.get("x-request-id") ?? undefined,
        error:
          parseError instanceof Error ? parseError.message : String(parseError),
      });
      return undefined;
    }

    if (
      parsed === null ||
      typeof parsed !== "object" ||
      Array.isArray(parsed)
    ) {
      return undefined;
    }

    return parsed as Partial<UserSession>;
  }
}
