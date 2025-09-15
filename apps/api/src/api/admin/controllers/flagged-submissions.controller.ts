import {
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
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from "@nestjs/swagger";
import { AdminService } from "../admin.service";

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
  path: "admin/flagged-submissions",
  version: "1",
})
export class FlaggedSubmissionsController {
  constructor(private adminService: AdminService) {}

  @Get()
  @ApiOperation({ summary: "Get all flagged submissions" })
  @ApiResponse({ status: 200 })
  @ApiResponse({ status: 403 })
  getFlaggedSubmissions() {
    return this.adminService.getFlaggedSubmissions();
  }

  @Post(":id/dismiss")
  @ApiOperation({ summary: "Dismiss a flagged submission" })
  @ApiParam({ name: "id", required: true })
  @ApiResponse({ status: 200 })
  @ApiResponse({ status: 403 })
  dismissFlaggedSubmission(@Param("id") id: number) {
    return this.adminService.dismissFlaggedSubmission(Number(id));
  }
}
