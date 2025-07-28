import { Injectable, UnauthorizedException } from "@nestjs/common";
import { PassportStrategy } from "@nestjs/passport";
import { ExtractJwt, Strategy, VerifiedCallback } from "passport-jwt";
import { UserSession } from "../../interfaces/user.session.interface";
import { JwtConfigService } from "../jwt.config.service";

interface IJwtPayload extends UserSession {
  admin: boolean;
  iat: number;
  exp: number;
}

@Injectable()
export class JwtBearerTokenStrategy extends PassportStrategy(
  Strategy,
  "bearer-token-strategy",
) {
  constructor(private configService: JwtConfigService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: configService.jwtConstants.secret,
    });
  }

  validate(payload: IJwtPayload, done: VerifiedCallback) {
    if (payload.admin) {
      done(undefined, payload);
    } else {
      done(new UnauthorizedException("Not authorized"), false);
    }
  }
}
