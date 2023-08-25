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
  Req,
  Request,
  UnauthorizedException,
  UseGuards,
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
import { getAdminAuthGuard } from "../../auth/jwt/admin/utils";
import { Admin } from "../../auth/jwt/jwt.global.auth.guard";
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
import { CreateTokenRequestDto } from "./dto/create.token.request.dto";

@ApiTags("Admin (Requires a JWT Bearer token for authorization)")
@UsePipes(
  new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
  })
)
@UseGuards(getAdminAuthGuard())
@Admin()
@ApiBearerAuth()
@Injectable()
@Controller({
  path: "admin",
  version: "1",
})
export class AdminController {
  constructor(private adminService: AdminService) {}

  @Post("tokens")
  @ApiOperation({
    summary: "Create a new admin token",
    description:
      "This endpoint creates a new admin token. Requires a JWT Bearer token for authorization.",
  })
  @ApiBody({
    type: CreateTokenRequestDto,
    description: "Data to create a new admin token",
  })
  createToken(
    @Body() createTokenRequestDto: CreateTokenRequestDto,
    @Req() request: Request
  ) {
    //request.user contains the token's payload
    if (!("user" in request)) {
      throw new UnauthorizedException("Invalid token");
    }

    const newToken = this.adminService.createJWTToken(createTokenRequestDto);
    return { token: newToken };
  }

  @Post("assignments/clone/:id")
  @ApiOperation({
    summary: "Clone an assignment and associates it with the provided groupID",
  })
  @ApiParam({ name: "id", required: true })
  @ApiResponse({ status: 200, type: BaseAssignmentResponseDto })
  @ApiResponse({ status: 403 })
  cloneAssignment(
    @Param("id") assignmentID: number,
    @Body() assignmentCloneRequestDto: AdminAssignmentCloneRequestDto
  ): Promise<BaseAssignmentResponseDto> {
    return this.adminService.cloneAssignment(
      Number(assignmentID),
      assignmentCloneRequestDto.groupID
    );
  }

  @Post("assignments/:assignmentId/groups/:groupId")
  @ApiOperation({ summary: "Associate an assignment with a group" })
  @ApiParam({ name: "id", required: true })
  @ApiResponse({ status: 200, type: AdminAddAssignmentToGroupResponseDto })
  @ApiResponse({ status: 403 })
  addAssignmentToGroup(
    @Param("assignmentId") assignmentID: number,
    @Param("groupId") groupID: string
  ): Promise<AdminAddAssignmentToGroupResponseDto> {
    return this.adminService.addAssignmentToGroup(
      Number(assignmentID),
      groupID
    );
  }

  @Post("/assignments")
  @ApiOperation({ summary: "Create an assignment" })
  @ApiBody({ type: AdminCreateAssignmentRequestDto })
  @ApiResponse({ status: 201, type: BaseAssignmentResponseDto })
  @ApiResponse({ status: 403 })
  createAssignment(
    @Body() createAssignmentRequestDto: AdminCreateAssignmentRequestDto
  ): Promise<BaseAssignmentResponseDto> {
    return this.adminService.createAssignment(createAssignmentRequestDto);
  }

  @Get("/assignments/:id")
  @ApiOperation({ summary: "Get an assignment" })
  @ApiParam({ name: "id", required: true })
  @ApiResponse({ status: 201, type: BaseAssignmentResponseDto })
  @ApiResponse({ status: 403 })
  async getAssignment(
    @Param("id") id: number
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
    @Body() replaceAssignmentRequestDto: AdminReplaceAssignmentRequestDto
  ): Promise<BaseAssignmentResponseDto> {
    return this.adminService.replaceAssignment(
      Number(id),
      replaceAssignmentRequestDto
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
    @Body() updateAssignmentRequestDto: AdminUpdateAssignmentRequestDto
  ): Promise<BaseAssignmentResponseDto> {
    return this.adminService.updateAssignment(
      Number(id),
      updateAssignmentRequestDto
    );
  }

  @Delete("assignments/:id")
  @ApiOperation({ summary: "Delete an assignment" })
  @ApiParam({ name: "id", required: true })
  @ApiResponse({ status: 200, type: BaseAssignmentResponseDto })
  @ApiResponse({ status: 403 })
  deleteAssignment(
    @Param("id") id: number
  ): Promise<BaseAssignmentResponseDto> {
    return this.adminService.removeAssignment(Number(id));
  }
}
