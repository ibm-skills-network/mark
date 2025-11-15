import {
  Body,
  Controller,
  Get,
  Injectable,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from "@nestjs/common";
import {
  ApiBearerAuth,
  ApiBody,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from "@nestjs/swagger";
import {
  UserRole,
  UserSessionRequest,
} from "src/auth/interfaces/user.session.interface";
import { Roles } from "src/auth/role/roles.global.guard";
import { AdminService } from "../admin.service";

class ApproveRegradingRequestDto {
  newGrade: number;
}

class RejectRegradingRequestDto {
  reason: string;
}

@ApiTags("Author - Regrading Requests")
@UsePipes(
  new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
  }),
)
@ApiBearerAuth()
@Injectable()
@Controller({
  path: "author/regrading-requests",
  version: "1",
})
export class AuthorRegradingRequestsController {
  constructor(private adminService: AdminService) {}

  @Get()
  @Roles(UserRole.AUTHOR)
  @ApiOperation({
    summary:
      "Get all regrading requests for assignments created by this author",
  })
  @ApiQuery({
    name: "assignmentId",
    required: false,
    description: "Filter by specific assignment ID",
  })
  @ApiResponse({ status: 200 })
  @ApiResponse({ status: 403 })
  async getAuthorRegradingRequests(
    @Req() request: UserSessionRequest,
    @Query("assignmentId") assignmentId?: string,
  ) {
    const userId = request.userSession.userId;
    return this.adminService.getAuthorRegradingRequests(
      userId,
      assignmentId ? Number(assignmentId) : undefined,
    );
  }

  @Post(":id/approve")
  @Roles(UserRole.AUTHOR)
  @ApiOperation({
    summary:
      "Approve a regrading request (authors can only approve their own assignment requests)",
  })
  @ApiParam({ name: "id", required: true, description: "Regrading request ID" })
  @ApiBody({ type: ApproveRegradingRequestDto })
  @ApiResponse({ status: 200 })
  @ApiResponse({ status: 403 })
  @ApiResponse({ status: 404 })
  async approveRegradingRequest(
    @Param("id") id: number,
    @Body() approveDto: ApproveRegradingRequestDto,
    @Req() request: UserSessionRequest,
  ) {
    const userId = request.userSession.userId;
    return this.adminService.approveAuthorRegradingRequest(
      Number(id),
      approveDto.newGrade,
      userId,
    );
  }

  @Post(":id/reject")
  @Roles(UserRole.AUTHOR)
  @ApiOperation({
    summary:
      "Reject a regrading request (authors can only reject their own assignment requests)",
  })
  @ApiParam({ name: "id", required: true, description: "Regrading request ID" })
  @ApiBody({ type: RejectRegradingRequestDto })
  @ApiResponse({ status: 200 })
  @ApiResponse({ status: 403 })
  @ApiResponse({ status: 404 })
  async rejectRegradingRequest(
    @Param("id") id: number,
    @Body() rejectDto: RejectRegradingRequestDto,
    @Req() request: UserSessionRequest,
  ) {
    const userId = request.userSession.userId;
    return this.adminService.rejectAuthorRegradingRequest(
      Number(id),
      rejectDto.reason,
      userId,
    );
  }
}
