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
  AutoSaveDto,
  CompareVersionsDto,
  CreateVersionDto,
  RestoreVersionDto,
  SaveDraftDto,
  UpdateVersionDescriptionDto,
  UpdateVersionNumberDto,
  VersionComparison,
  VersionSummary,
} from "../dtos/version-management.dto";
import { VersionManagementService } from "../services/version-management.service";

@ApiTags("Assignment Version Management")
@Controller({
  path: "assignments/:assignmentId/versions",
  version: "2",
})
@UseGuards(AssignmentAccessControlGuard)
export class VersionManagementController {
  constructor(private readonly versionService: VersionManagementService) {}

  @Post()
  @Roles(UserRole.AUTHOR)
  @ApiOperation({ summary: "Create a new version of an assignment" })
  @ApiParam({
    name: "assignmentId",
    type: "number",
    description: "Assignment ID",
  })
  @ApiBody({ type: CreateVersionDto })
  @ApiResponse({ status: 201, description: "Version created successfully" })
  @ApiResponse({ status: 404, description: "Assignment not found" })
  @ApiResponse({ status: 403, description: "Insufficient permissions" })
  async createVersion(
    @Param("assignmentId", ParseIntPipe) assignmentId: number,
    @Body() createVersionDto: CreateVersionDto,
    @Req() request: UserSessionRequest,
  ): Promise<VersionSummary> {
    return await this.versionService.createVersion(
      assignmentId,
      createVersionDto,
      request.userSession,
    );
  }

  @Get()
  @Roles(UserRole.AUTHOR)
  @ApiOperation({ summary: "List all versions of an assignment" })
  @ApiParam({
    name: "assignmentId",
    type: "number",
    description: "Assignment ID",
  })
  @ApiResponse({
    status: 200,
    description: "List of assignment versions",
    type: [VersionSummary],
  })
  @ApiResponse({ status: 404, description: "Assignment not found" })
  async listVersions(
    @Param("assignmentId", ParseIntPipe) assignmentId: number,
    @Req() request: UserSessionRequest,
  ): Promise<VersionSummary[]> {
    console.log(
      "Received assignmentId:",
      assignmentId,
      "type:",
      typeof assignmentId,
    );

    if (!request?.userSession) {
      throw new Error("User session is required");
    }

    return await this.versionService.listVersions(assignmentId);
  }

  @Get(":versionId")
  @Roles(UserRole.AUTHOR)
  @ApiOperation({ summary: "Get a specific version of an assignment" })
  @ApiParam({
    name: "assignmentId",
    type: "number",
    description: "Assignment ID",
  })
  @ApiParam({ name: "versionId", type: "number", description: "Version ID" })
  @ApiResponse({ status: 200, description: "Assignment version details" })
  @ApiResponse({ status: 404, description: "Assignment or version not found" })
  async getVersion(
    @Param("assignmentId", ParseIntPipe) assignmentId: number,
    @Param("versionId", ParseIntPipe) versionId: number,
  ): Promise<any> {
    return await this.versionService.getVersion(assignmentId, versionId);
  }

  @Post("draft")
  @Roles(UserRole.AUTHOR)
  @ApiOperation({ summary: "Save assignment snapshot as a draft version" })
  @ApiParam({
    name: "assignmentId",
    type: "number",
    description: "Assignment ID",
  })
  @ApiBody({
    schema: {
      type: "object",
      properties: {
        versionNumber: {
          type: "string",
          description: "Version number (e.g., 1.0.0-rc1)",
        },
        versionDescription: {
          type: "string",
          description: "Version description",
        },
        assignmentData: {
          type: "object",
          description: "Assignment data snapshot",
        },
        questionsData: {
          type: "array",
          description: "Questions data snapshot",
        },
      },
      required: ["versionNumber", "assignmentData"],
    },
  })
  @ApiResponse({ status: 201, description: "Draft saved successfully" })
  @ApiResponse({ status: 404, description: "Assignment not found" })
  async saveDraft(
    @Param("assignmentId", ParseIntPipe) assignmentId: number,
    @Body()
    draftData: {
      versionNumber: string;
      versionDescription?: string;
      assignmentData: any;
      questionsData?: any[];
    },
    @Req() request: UserSessionRequest,
  ): Promise<VersionSummary> {
    return await this.versionService.saveDraftSnapshot(
      assignmentId,
      draftData,
      request.userSession,
    );
  }

  @Put(":versionId/restore")
  @Roles(UserRole.AUTHOR)
  @ApiOperation({ summary: "Restore assignment to a specific version" })
  @ApiParam({
    name: "assignmentId",
    type: "number",
    description: "Assignment ID",
  })
  @ApiParam({
    name: "versionId",
    type: "number",
    description: "Version ID to restore",
  })
  @ApiBody({
    schema: {
      type: "object",
      properties: {
        createAsNewVersion: {
          type: "boolean",
          description: "Create as new version instead of activating existing",
        },
        versionDescription: {
          type: "string",
          description: "Description for the restored version",
        },
      },
    },
  })
  @ApiResponse({ status: 200, description: "Version restored successfully" })
  @ApiResponse({ status: 404, description: "Assignment or version not found" })
  async restoreVersion(
    @Param("assignmentId", ParseIntPipe) assignmentId: number,
    @Param("versionId", ParseIntPipe) versionId: number,
    @Body() restoreDto: Omit<RestoreVersionDto, "versionId">,
    @Req() request: UserSessionRequest,
  ): Promise<VersionSummary> {
    const restoreVersionDto: RestoreVersionDto = {
      ...restoreDto,
      versionId,
    };
    return await this.versionService.restoreVersion(
      assignmentId,
      restoreVersionDto,
      request.userSession,
    );
  }

  @Post("compare")
  @Roles(UserRole.AUTHOR)
  @ApiOperation({ summary: "Compare two versions of an assignment" })
  @ApiParam({
    name: "assignmentId",
    type: "number",
    description: "Assignment ID",
  })
  @ApiBody({
    schema: {
      type: "object",
      properties: {
        fromVersionId: {
          type: "number",
          description: "Version ID to compare from",
        },
        toVersionId: {
          type: "number",
          description: "Version ID to compare to",
        },
      },
      required: ["fromVersionId", "toVersionId"],
    },
  })
  @ApiResponse({
    status: 200,
    description: "Version comparison",
    type: VersionComparison,
  })
  @ApiResponse({ status: 404, description: "Assignment or version not found" })
  @HttpCode(HttpStatus.OK)
  async compareVersions(
    @Param("assignmentId", ParseIntPipe) assignmentId: number,
    @Body() compareDto: CompareVersionsDto,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    @Req() request: UserSessionRequest,
  ): Promise<VersionComparison> {
    return await this.versionService.compareVersions(assignmentId, compareDto);
  }

  @Get("history")
  @Roles(UserRole.AUTHOR)
  @ApiOperation({ summary: "Get version history for an assignment" })
  @ApiParam({
    name: "assignmentId",
    type: "number",
    description: "Assignment ID",
  })
  @ApiResponse({ status: 200, description: "Version history timeline" })
  @ApiResponse({ status: 404, description: "Assignment not found" })
  async getVersionHistory(
    @Param("assignmentId", ParseIntPipe) assignmentId: number,
    @Req() request: UserSessionRequest,
  ) {
    console.log(
      "getVersionHistory called with assignmentId:",
      assignmentId,
      "type:",
      typeof assignmentId,
    );
    return await this.versionService.getVersionHistory(
      assignmentId,
      request.userSession,
    );
  }

  @Put(":versionId/activate")
  @Roles(UserRole.AUTHOR)
  @ApiOperation({
    summary: "Activate a specific version as the current version",
  })
  @ApiParam({
    name: "assignmentId",
    type: "number",
    description: "Assignment ID",
  })
  @ApiParam({
    name: "versionId",
    type: "number",
    description: "Version ID to activate",
  })
  @ApiResponse({ status: 200, description: "Version activated successfully" })
  @ApiResponse({ status: 404, description: "Assignment or version not found" })
  async activateVersion(
    @Param("assignmentId", ParseIntPipe) assignmentId: number,
    @Param("versionId", ParseIntPipe) versionId: number,
    @Req() request: UserSessionRequest,
  ): Promise<VersionSummary> {
    return await this.versionService.restoreVersion(
      assignmentId,
      { versionId, createAsNewVersion: false },
      request.userSession,
    );
  }

  @Put(":versionId/publish")
  @Roles(UserRole.AUTHOR)
  @ApiOperation({
    summary: "Publish a specific version",
  })
  @ApiParam({
    name: "assignmentId",
    type: "number",
    description: "Assignment ID",
  })
  @ApiParam({
    name: "versionId",
    type: "number",
    description: "Version ID to publish",
  })
  @ApiResponse({ status: 200, description: "Version published successfully" })
  @ApiResponse({ status: 404, description: "Assignment or version not found" })
  @ApiResponse({ status: 400, description: "Version already published" })
  async publishVersion(
    @Param("assignmentId", ParseIntPipe) assignmentId: number,
    @Param("versionId", ParseIntPipe) versionId: number,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    @Req() request: UserSessionRequest,
  ): Promise<VersionSummary> {
    return await this.versionService.publishVersion(assignmentId, versionId);
  }

  @Post("auto-save")
  @Roles(UserRole.AUTHOR)
  @ApiOperation({
    summary:
      "Auto-save assignment changes as a draft (for temporary server-side saving)",
  })
  @ApiParam({
    name: "assignmentId",
    type: "number",
    description: "Assignment ID",
  })
  @ApiBody({
    schema: {
      type: "object",
      properties: {
        assignmentData: {
          type: "object",
          description: "Partial assignment data to save",
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
  @ApiResponse({ status: 201, description: "Changes auto-saved successfully" })
  @ApiResponse({ status: 404, description: "Assignment not found" })
  @HttpCode(HttpStatus.CREATED)
  async autoSave(
    @Param("assignmentId", ParseIntPipe) assignmentId: number,
    @Body() autoSaveData: AutoSaveDto,
    @Req() request: UserSessionRequest,
  ): Promise<VersionSummary> {
    const saveDraftDto: SaveDraftDto = {
      ...autoSaveData,
      versionDescription: "Auto-saved changes",
    };
    return await this.versionService.saveDraft(
      assignmentId,
      saveDraftDto,
      request.userSession,
    );
  }

  @Get("draft/latest")
  @Roles(UserRole.AUTHOR)
  @ApiOperation({ summary: "Get user's latest draft version of an assignment" })
  @ApiParam({
    name: "assignmentId",
    type: "number",
    description: "Assignment ID",
  })
  @ApiResponse({ status: 200, description: "Latest draft version data" })
  @ApiResponse({ status: 404, description: "No draft found" })
  async getLatestDraft(
    @Param("assignmentId", ParseIntPipe) assignmentId: number,
    @Req() request: UserSessionRequest,
  ): Promise<any> {
    if (!request?.userSession) {
      throw new Error("User session is required");
    }

    return await this.versionService.getUserLatestDraft(
      assignmentId,
      request.userSession,
    );
  }

  @Post(":versionId/restore-questions")
  @Roles(UserRole.AUTHOR)
  @ApiOperation({
    summary: "Restore deleted questions from a specific version",
  })
  @ApiParam({
    name: "assignmentId",
    type: "number",
    description: "Assignment ID",
  })
  @ApiParam({
    name: "versionId",
    type: "number",
    description: "Version ID to restore questions from",
  })
  @ApiBody({
    schema: {
      type: "object",
      properties: {
        questionIds: {
          type: "array",
          items: { type: "number" },
          description: "Array of question IDs to restore",
        },
      },
      required: ["questionIds"],
    },
  })
  @ApiResponse({ status: 200, description: "Questions restored successfully" })
  @ApiResponse({ status: 404, description: "Version or questions not found" })
  restoreDeletedQuestions(
    @Param("assignmentId", ParseIntPipe) assignmentId: number,
    @Param("versionId", ParseIntPipe) versionId: number,
    @Body() body: { questionIds: number[] },
    @Req() request: UserSessionRequest,
  ): Promise<VersionSummary> {
    if (!request?.userSession) {
      throw new Error("User session is required");
    }

    return this.versionService.restoreDeletedQuestions(
      assignmentId,
      versionId,
      body.questionIds,
      request.userSession,
    );
  }

  @Put(":versionId/description")
  @Roles(UserRole.AUTHOR)
  @ApiOperation({ summary: "Update version description" })
  @ApiParam({
    name: "assignmentId",
    type: "number",
    description: "Assignment ID",
  })
  @ApiParam({
    name: "versionId",
    type: "number",
    description: "Version ID",
  })
  @ApiBody({ type: UpdateVersionDescriptionDto })
  @ApiResponse({
    status: 200,
    description: "Version description updated successfully",
  })
  @ApiResponse({ status: 404, description: "Version not found" })
  async updateVersionDescription(
    @Param("assignmentId", ParseIntPipe) assignmentId: number,
    @Param("versionId", ParseIntPipe) versionId: number,
    @Body() updateVersionDescriptionDto: UpdateVersionDescriptionDto,
    @Req() request: UserSessionRequest,
  ): Promise<VersionSummary> {
    return this.versionService.updateVersionDescription(
      assignmentId,
      versionId,
      updateVersionDescriptionDto.versionDescription,
      request.userSession,
    );
  }

  @Put(":versionId/version-number")
  @Roles(UserRole.AUTHOR)
  @ApiOperation({ summary: "Update version number" })
  @ApiParam({
    name: "assignmentId",
    type: "number",
    description: "Assignment ID",
  })
  @ApiParam({
    name: "versionId",
    type: "number",
    description: "Version ID",
  })
  @ApiBody({ type: UpdateVersionNumberDto })
  @ApiResponse({
    status: 200,
    description: "Version number updated successfully",
  })
  @ApiResponse({ status: 404, description: "Version not found" })
  @ApiResponse({ status: 400, description: "Version number already exists" })
  async updateVersionNumber(
    @Param("assignmentId", ParseIntPipe) assignmentId: number,
    @Param("versionId", ParseIntPipe) versionId: number,
    @Body() updateVersionNumberDto: UpdateVersionNumberDto,
    @Req() request: UserSessionRequest,
  ): Promise<VersionSummary> {
    return this.versionService.updateVersionNumber(
      assignmentId,
      versionId,
      updateVersionNumberDto.versionNumber,
      request.userSession,
    );
  }

  @Delete(":versionId")
  @Roles(UserRole.AUTHOR)
  @ApiOperation({ summary: "Delete a specific version" })
  @ApiParam({
    name: "assignmentId",
    type: "number",
    description: "Assignment ID",
  })
  @ApiParam({
    name: "versionId",
    type: "number",
    description: "Version ID to delete",
  })
  @ApiResponse({ status: 200, description: "Version deleted successfully" })
  @ApiResponse({ status: 404, description: "Version not found" })
  @ApiResponse({ status: 400, description: "Cannot delete active version" })
  @HttpCode(HttpStatus.OK)
  async deleteVersion(
    @Param("assignmentId", ParseIntPipe) assignmentId: number,
    @Param("versionId", ParseIntPipe) versionId: number,
    @Req() request: UserSessionRequest,
  ): Promise<{ message: string }> {
    await this.versionService.deleteVersion(
      assignmentId,
      versionId,
      request.userSession,
    );
    return { message: "Version deleted successfully" };
  }
}
