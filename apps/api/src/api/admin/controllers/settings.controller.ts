import {
  Body,
  Controller,
  Get,
  Put,
  Req,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from "@nestjs/common";
import {
  ApiBearerAuth,
  ApiBody,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from "@nestjs/swagger";
import { IsBoolean } from "class-validator";
import { AdminService } from "../admin.service";
import { AdminGuard } from "../../../auth/guards/admin.guard";
import { Request } from "express";

interface AdminSessionRequest extends Request {
  userSession: {
    userId: string;
    role: string;
  };
}

class UpdateSettingsDto {
  @IsBoolean()
  emailOnRegradingRequest: boolean;
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
@Controller({
  path: "admin-dashboard/settings",
  version: "1",
})
export class SettingsController {
  constructor(private adminService: AdminService) {}

  @Get()
  @ApiOperation({ summary: "Get author settings" })
  @ApiResponse({ status: 200 })
  @ApiResponse({ status: 403 })
  getSettings(@Req() request: AdminSessionRequest) {
    return this.adminService.getAuthorSettings(request.userSession?.userId);
  }

  @Put()
  @ApiOperation({ summary: "Update author settings" })
  @ApiBody({ type: UpdateSettingsDto })
  @ApiResponse({ status: 200 })
  @ApiResponse({ status: 403 })
  updateSettings(
    @Req() request: AdminSessionRequest,
    @Body() settingsDto: UpdateSettingsDto,
  ) {
    return this.adminService.updateAuthorSettings(
      request.userSession?.userId,
      settingsDto,
    );
  }
}
