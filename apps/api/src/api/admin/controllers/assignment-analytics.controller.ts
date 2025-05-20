// src/server/admin/assignment-analytics.controller.ts
import {
    Controller,
    Get,
    Param,
    Injectable,
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
    path: "admin/assignments",
    version: "1",
  })
  export class AssignmentAnalyticsController {
    constructor(private adminService: AdminService) {}
  
    @Get(":id/analytics")
    @ApiOperation({ summary: "Get analytics for an assignment" })
    @ApiParam({ name: "id", required: true })
    @ApiResponse({ status: 200 })
    @ApiResponse({ status: 403 })
    getAssignmentAnalytics(@Param("id") id: number) {
      return this.adminService.getAssignmentAnalytics(Number(id));
    }
  }