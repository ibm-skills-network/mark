import { Injectable, UnauthorizedException } from "@nestjs/common";
import { PassportStrategy } from "@nestjs/passport";
import { ExtractJwt, Strategy, VerifiedCallback } from "passport-jwt";
import { User } from "../../interfaces/user.interface";
import { JwtConfigService } from "../jwt.config.service";

interface IJwtPayload extends User {
  admin: boolean;
  iat: number;
  exp: number;
}

@Injectable()
export class JwtAdminStrategy extends PassportStrategy(Strategy, "jwt-admin") {
  constructor(private configService: JwtConfigService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: configService.jwtConstants.secret,
    });
  }

  validate(payload: IJwtPayload, done: VerifiedCallback) {
    console.log("payload", payload);
    if (payload.admin) {
      done(undefined, payload);
    } else {
      done(new UnauthorizedException("Not authorized"), false);
    }
  }
}
