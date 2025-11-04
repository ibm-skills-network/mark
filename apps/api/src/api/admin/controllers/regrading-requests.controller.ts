import {
  Body,
  Controller,
  Get,
  Injectable,
  Param,
  Post,
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
  ApiResponse,
  ApiTags,
} from "@nestjs/swagger";
import { IsNumber, IsString, IsNotEmpty } from "class-validator";
import { AdminService } from "../admin.service";
import { AdminGuard } from "../../../auth/guards/admin.guard";
import { Request } from "express";

interface AdminSessionRequest extends Request {
  userSession: {
    userId: string;
    role: string;
  };
}

class ApproveRegradingRequestDto {
  @IsNumber()
  @IsNotEmpty()
  newGrade: number;
}

class RejectRegradingRequestDto {
  @IsString()
  @IsNotEmpty()
  reason: string;
}

@ApiTags("Admin")
@UseGuards(AdminGuard)
@UsePipes(
  new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
  }),
)
@ApiBearerAuth()
@Injectable()
@Controller({
  path: "admin-dashboard/regrading-requests",
  version: "1",
})
export class RegradingRequestsController {
  constructor(private adminService: AdminService) {}

  @Get()
  @ApiOperation({ summary: "Get all regrading requests" })
  @ApiResponse({ status: 200 })
  @ApiResponse({ status: 403 })
  getRegradingRequests() {
    return this.adminService.getRegradingRequests();
  }

  @Post(":id/approve")
  @ApiOperation({ summary: "Approve a regrading request" })
  @ApiParam({ name: "id", required: true })
  @ApiBody({ type: ApproveRegradingRequestDto })
  @ApiResponse({ status: 200 })
  @ApiResponse({ status: 403 })
  approveRegradingRequest(
    @Param("id") id: number,
    @Body() approveDto: ApproveRegradingRequestDto,
    @Req() request: AdminSessionRequest,
  ) {
    return this.adminService.approveRegradingRequest(
      Number(id),
      approveDto.newGrade,
      request.userSession?.userId,
    );
  }

  @Post(":id/reject")
  @ApiOperation({ summary: "Reject a regrading request" })
  @ApiParam({ name: "id", required: true })
  @ApiBody({ type: RejectRegradingRequestDto })
  @ApiResponse({ status: 200 })
  @ApiResponse({ status: 403 })
  rejectRegradingRequest(
    @Param("id") id: number,
    @Body() rejectDto: RejectRegradingRequestDto,
    @Req() request: AdminSessionRequest,
  ) {
    return this.adminService.rejectRegradingRequest(
      Number(id),
      rejectDto.reason,
      request.userSession?.userId,
    );
  }
}
