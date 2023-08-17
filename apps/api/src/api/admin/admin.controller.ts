import {
  Body,
  Controller,
  Injectable,
  Post,
  Req,
  Request,
  UnauthorizedException,
  UseGuards,
  Version,
} from "@nestjs/common";
import { ApiBearerAuth, ApiBody, ApiOperation, ApiTags } from "@nestjs/swagger";
import { JwtAdminAuthGuard } from "../../auth/jwt/admin/jwt.admin.auth.guard";
import { Admin } from "../../auth/jwt/jwt.global.auth.guard";
import { AdminService } from "./admin.service";
import { CreateTokenRequestDto } from "./dto/create.token.request.dto";

@ApiTags("Admin (Requires a JWT Bearer token for authorization)")
@Injectable()
@Controller({
  path: "admin",
  version: "1",
})
export class AdminController {
  constructor(private adminService: AdminService) {}

  @UseGuards(JwtAdminAuthGuard)
  @Admin()
  @Post("tokens")
  @ApiBearerAuth()
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

    const newToken = this.adminService.createAdminToken(createTokenRequestDto);
    return { token: newToken };
  }
}
