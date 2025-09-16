import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Post,
  Put,
  Req,
  UseGuards,
} from "@nestjs/common";
import {
  ApiBody,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from "@nestjs/swagger";
import {
  UserRole,
  UserSessionRequest,
} from "../../../../auth/interfaces/user.session.interface";
import { Roles } from "../../../../auth/role/roles.global.guard";
import { AssignmentAccessControlGuard } from "../../guards/assignment.access.control.guard";
import {
  DraftManagementService,
  DraftSummary,
  SaveDraftDto,
} from "../services/draft-management.service";

@ApiTags("Assignment Draft Management")
@Controller({
  path: "assignments/:assignmentId/drafts",
  version: "2",
})
@UseGuards(AssignmentAccessControlGuard)
export class DraftManagementController {
  constructor(private readonly draftService: DraftManagementService) {}

  @Post()
  @Roles(UserRole.AUTHOR)
  @ApiOperation({ summary: "Save current assignment state as a draft" })
  @ApiParam({
    name: "assignmentId",
    type: "number",
    description: "Assignment ID",
  })
  @ApiBody({
    schema: {
      type: "object",
      properties: {
        draftName: {
          type: "string",
          description: "Name for this draft",
        },
        assignmentData: {
          type: "object",
          description: "Assignment data to save",
        },
        questionsData: {
          type: "array",
          description: "Questions data to save",
          items: { type: "object" },
        },
      },
      required: ["assignmentData"],
    },
  })
  @ApiResponse({ status: 201, description: "Draft saved successfully" })
  @ApiResponse({ status: 404, description: "Assignment not found" })
  @HttpCode(HttpStatus.CREATED)
  async saveDraft(
    @Param("assignmentId", ParseIntPipe) assignmentId: number,
    @Body() saveDraftDto: SaveDraftDto,
    @Req() request: UserSessionRequest,
  ): Promise<DraftSummary> {
    return await this.draftService.saveDraft(
      assignmentId,
      saveDraftDto,
      request.userSession,
    );
  }

  @Put(":draftId")
  @Roles(UserRole.AUTHOR)
  @ApiOperation({ summary: "Update an existing draft" })
  @ApiParam({
    name: "assignmentId",
    type: "number",
    description: "Assignment ID",
  })
  @ApiParam({
    name: "draftId",
    type: "number",
    description: "Draft ID to update",
  })
  @ApiBody({
    schema: {
      type: "object",
      properties: {
        draftName: {
          type: "string",
          description: "Name for this draft",
        },
        assignmentData: {
          type: "object",
          description: "Assignment data to save",
        },
        questionsData: {
          type: "array",
          description: "Questions data to save",
          items: { type: "object" },
        },
      },
    },
  })
  @ApiResponse({ status: 200, description: "Draft updated successfully" })
  @ApiResponse({ status: 404, description: "Draft not found" })
  async updateDraft(
    @Param("assignmentId", ParseIntPipe) assignmentId: number,
    @Param("draftId", ParseIntPipe) draftId: number,
    @Body() saveDraftDto: SaveDraftDto,
    @Req() request: UserSessionRequest,
  ): Promise<DraftSummary> {
    return await this.draftService.updateDraft(
      draftId,
      saveDraftDto,
      request.userSession,
    );
  }

  @Get()
  @Roles(UserRole.AUTHOR)
  @ApiOperation({ summary: "List all drafts for current user and assignment" })
  @ApiParam({
    name: "assignmentId",
    type: "number",
    description: "Assignment ID",
  })
  @ApiResponse({
    status: 200,
    description: "List of user drafts",
  })
  @ApiResponse({ status: 404, description: "Assignment not found" })
  async listUserDrafts(
    @Param("assignmentId", ParseIntPipe) assignmentId: number,
    @Req() request: UserSessionRequest,
  ): Promise<DraftSummary[]> {
    return await this.draftService.listUserDrafts(
      assignmentId,
      request.userSession,
    );
  }

  @Get("latest")
  @Roles(UserRole.AUTHOR)
  @ApiOperation({ summary: "Get user's latest draft for an assignment" })
  @ApiParam({
    name: "assignmentId",
    type: "number",
    description: "Assignment ID",
  })
  @ApiResponse({ status: 200, description: "Latest draft data" })
  @ApiResponse({ status: 404, description: "No draft found" })
  async getLatestDraft(
    @Param("assignmentId", ParseIntPipe) assignmentId: number,
    @Req() request: UserSessionRequest,
  ): Promise<any> {
    return await this.draftService.getLatestDraft(
      assignmentId,
      request.userSession,
    );
  }

  @Get(":draftId")
  @Roles(UserRole.AUTHOR)
  @ApiOperation({ summary: "Get a specific draft" })
  @ApiParam({
    name: "assignmentId",
    type: "number",
    description: "Assignment ID",
  })
  @ApiParam({ name: "draftId", type: "number", description: "Draft ID" })
  @ApiResponse({ status: 200, description: "Draft data" })
  @ApiResponse({ status: 404, description: "Draft not found" })
  async getDraft(
    @Param("assignmentId", ParseIntPipe) assignmentId: number,
    @Param("draftId", ParseIntPipe) draftId: number,
    @Req() request: UserSessionRequest,
  ): Promise<any> {
    return await this.draftService.getDraft(draftId, request.userSession);
  }

  @Delete(":draftId")
  @Roles(UserRole.AUTHOR)
  @ApiOperation({ summary: "Delete a draft" })
  @ApiParam({
    name: "assignmentId",
    type: "number",
    description: "Assignment ID",
  })
  @ApiParam({ name: "draftId", type: "number", description: "Draft ID" })
  @ApiResponse({ status: 204, description: "Draft deleted successfully" })
  @ApiResponse({ status: 404, description: "Draft not found" })
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteDraft(
    @Param("assignmentId", ParseIntPipe) assignmentId: number,
    @Param("draftId", ParseIntPipe) draftId: number,
    @Req() request: UserSessionRequest,
  ): Promise<void> {
    return await this.draftService.deleteDraft(draftId, request.userSession);
  }
}
