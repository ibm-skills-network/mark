/* eslint-disable @typescript-eslint/require-await */
import {
  Body,
  Controller,
  Delete,
  Get,
  Injectable,
  Param,
  Patch,
  Post,
  Put,
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
import { AdminRepository } from "./admin.repository";
import { AdminService } from "./admin.service";
import { AdminAddAssignmentToGroupResponseDto } from "./dto/assignment/add.assignment.to.group.response.dto";
import { BaseAssignmentResponseDto } from "./dto/assignment/base.assignment.response.dto";
import { AdminAssignmentCloneRequestDto } from "./dto/assignment/clone.assignment.request.dto";
import {
  AdminCreateAssignmentRequestDto,
  AdminReplaceAssignmentRequestDto,
} from "./dto/assignment/create.replace.assignment.request.dto";
import { AdminGetAssignmentResponseDto } from "./dto/assignment/get.assignment.response.dto";
import { AdminUpdateAssignmentRequestDto } from "./dto/assignment/update.assignment.request.dto";

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
  constructor(
    private adminService: AdminService,
    private adminRepository: AdminRepository,
  ) {}

  @Post("assignments/clone/:id")
  @ApiOperation({
    summary: "Clone an assignment and associates it with the provided groupId",
  })
  @ApiParam({ name: "id", required: true })
  @ApiResponse({ status: 200, type: BaseAssignmentResponseDto })
  @ApiResponse({ status: 403 })
  cloneAssignment(
    @Param("id") assignmentId: number,
    @Body() assignmentCloneRequestDto: AdminAssignmentCloneRequestDto,
  ): Promise<BaseAssignmentResponseDto> {
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
  @ApiResponse({ status: 200, type: [BaseAssignmentResponseDto] })
  @ApiResponse({ status: 403 })
  getAssignments(): Promise<Assignment[]> {
    return this.adminRepository.findAllAssignments();
  }
  @Post("/assignments")
  @ApiOperation({ summary: "Create an assignment" })
  @ApiBody({ type: AdminCreateAssignmentRequestDto })
  @ApiResponse({ status: 201, type: BaseAssignmentResponseDto })
  @ApiResponse({ status: 403 })
  createAssignment(
    @Body() createAssignmentRequestDto: AdminCreateAssignmentRequestDto,
  ): Promise<BaseAssignmentResponseDto> {
    return this.adminService.createAssignment(createAssignmentRequestDto);
  }

  @Get("/assignments/:id")
  @ApiOperation({ summary: "Get an assignment" })
  @ApiParam({ name: "id", required: true })
  @ApiResponse({ status: 201, type: BaseAssignmentResponseDto })
  @ApiResponse({ status: 403 })
  async getAssignment(
    @Param("id") id: number,
  ): Promise<AdminGetAssignmentResponseDto> {
    return this.adminService.getAssignment(Number(id));
  }

  @Put("/assignments/:id")
  @ApiOperation({ summary: "Replace an assignment" })
  @ApiParam({ name: "id", required: true })
  @ApiBody({ type: AdminReplaceAssignmentRequestDto })
  @ApiResponse({ status: 200, type: BaseAssignmentResponseDto })
  @ApiResponse({ status: 403 })
  replaceAssignment(
    @Param("id") id: number,
    @Body() replaceAssignmentRequestDto: AdminReplaceAssignmentRequestDto,
  ): Promise<BaseAssignmentResponseDto> {
    return this.adminService.replaceAssignment(
      Number(id),
      replaceAssignmentRequestDto,
    );
  }

  @Patch("/assignments/:id")
  @ApiOperation({ summary: "Update an assignment" })
  @ApiParam({ name: "id", required: true })
  @ApiBody({ type: AdminUpdateAssignmentRequestDto })
  @ApiResponse({ status: 200, type: BaseAssignmentResponseDto })
  @ApiResponse({ status: 403 })
  updateAssignment(
    @Param("id") id: number,
    @Body() updateAssignmentRequestDto: AdminUpdateAssignmentRequestDto,
  ): Promise<BaseAssignmentResponseDto> {
    return this.adminService.updateAssignment(
      Number(id),
      updateAssignmentRequestDto,
    );
  }

  @Delete("assignments/:id")
  @ApiOperation({ summary: "Delete an assignment" })
  @ApiParam({ name: "id", required: true })
  @ApiResponse({ status: 200, type: BaseAssignmentResponseDto })
  @ApiResponse({ status: 403 })
  deleteAssignment(
    @Param("id") id: number,
  ): Promise<BaseAssignmentResponseDto> {
    return this.adminService.removeAssignment(Number(id));
  }
}
