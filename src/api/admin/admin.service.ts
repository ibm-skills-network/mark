import { Injectable } from "@nestjs/common";
import { sign } from "jsonwebtoken";
import { JwtConfigService } from "../../auth/jwt/jwt.config.service";
import { CreateTokenRequestDto } from "./dto/create.token.request.dto";

@Injectable()
export class AdminService {
  constructor(private jwtConfigService: JwtConfigService) {}

  createAdminToken(createTokenRequestDto: CreateTokenRequestDto) {
    const { username, role, groupID } = createTokenRequestDto;
    const { secret, signOptions } = this.jwtConfigService.jwtConstants;
    return sign({ username, role, groupID }, secret, signOptions);
  }
}
