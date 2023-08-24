import {
  Body,
  Controller,
  Delete,
  Get,
  Injectable,
  Param,
  Patch,
  Post,
  Req,
  Request,
  UnauthorizedException,
  UseGuards,
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
import { AddAssignmentToGroupResponseDto } from "./dto/assignment/add.assignment.to.group.response.dto";
import { BaseAssignmentResponseDto } from "./dto/assignment/base.assignment.response.dto";
import { AssignmentCloneRequestDto } from "./dto/assignment/clone.assignment.request.dto";
import {
  CreateAssignmentRequestDto,
  UpdateAssignmentRequestDto,
} from "./dto/assignment/create.update.assignment.request.dto";
import { GetAssignmentResponseDto } from "./dto/assignment/get.assignment.response.dto";
import { CreateTokenRequestDto } from "./dto/create.token.request.dto";

@ApiTags("Admin (Requires a JWT Bearer token for authorization)")
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
    @Body() assignmentCloneRequestDto: AssignmentCloneRequestDto
  ): Promise<BaseAssignmentResponseDto> {
    return this.adminService.cloneAssignment(
      Number(assignmentID),
      assignmentCloneRequestDto.groupID
    );
  }

  @Post("assignments/:assignmentId/groups/:groupId")
  @ApiOperation({ summary: "Associate an assignment with a group" })
  @ApiParam({ name: "id", required: true })
  @ApiResponse({ status: 200, type: AddAssignmentToGroupResponseDto })
  @ApiResponse({ status: 403 })
  addAssignmentToGroup(
    @Param("assignmentId") assignmentID: number,
    @Param("groupId") groupID: string
  ): Promise<AddAssignmentToGroupResponseDto> {
    return this.adminService.addAssignmentToGroup(
      Number(assignmentID),
      groupID
    );
  }

  @Post("/assignments")
  @ApiOperation({ summary: "Create an assignment" })
  @ApiBody({ type: CreateAssignmentRequestDto })
  @ApiResponse({ status: 201, type: BaseAssignmentResponseDto })
  @ApiResponse({ status: 403 })
  createAssignment(
    @Body() createAssignmentRequestDto: CreateAssignmentRequestDto
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
  ): Promise<GetAssignmentResponseDto> {
    return this.adminService.getAssignment(Number(id));
  }

  @Patch("/assignments/:id")
  @ApiOperation({ summary: "Update an assignment" })
  @ApiParam({ name: "id", required: true })
  @ApiBody({ type: UpdateAssignmentRequestDto })
  @ApiResponse({ status: 200, type: BaseAssignmentResponseDto })
  @ApiResponse({ status: 403 })
  updateAssignment(
    @Param("id") id: number,
    @Body() updateAssignmentRequestDto: UpdateAssignmentRequestDto
  ): Promise<BaseAssignmentResponseDto> {
    return this.adminService.updateAssignment(
      Number(id),
      updateAssignmentRequestDto
    );
  }

  @Delete("assignments/:id")
  @ApiOperation({ summary: "Delete an ssignment" })
  @ApiParam({ name: "id", required: true })
  @ApiResponse({ status: 200, type: BaseAssignmentResponseDto })
  @ApiResponse({ status: 403 })
  deleteAssignment(
    @Param("id") id: number
  ): Promise<BaseAssignmentResponseDto> {
    return this.adminService.removeAssignment(Number(id));
  }
}
