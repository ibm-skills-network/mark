import {
  Body,
  Controller,
  Get,
  Injectable,
  Param,
  Post,
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
import { AdminService } from "../admin.service";

class ApproveRegradingRequestDto {
  newGrade: number;
}

class RejectRegradingRequestDto {
  reason: string;
}

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
  path: "admin/regrading-requests",
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
  ) {
    return this.adminService.approveRegradingRequest(
      Number(id),
      approveDto.newGrade,
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
  ) {
    return this.adminService.rejectRegradingRequest(
      Number(id),
      rejectDto.reason,
    );
  }
}
