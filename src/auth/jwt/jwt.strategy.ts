import { Injectable } from "@nestjs/common";
import { PassportStrategy } from "@nestjs/passport";
import { Request } from "express";
import { ExtractJwt, Strategy } from "passport-jwt";
import { User } from "../models/user.model";
import { JwtConfigService } from "./jwt.config.service";

interface IRequestWithCookies extends Request {
  cookies: {
    [key: string]: string;
  };
}

interface IJwtPayload {
  //TODO: Add in the relevant properties
  iat: number;
  exp: number;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(private configService: JwtConfigService) {
    super({
      jwtFromRequest: ExtractJwt.fromExtractors([
        (request: IRequestWithCookies) => {
          return request?.cookies?.authentication;
        },
      ]),
      ignoreExpiration: false,
      secretOrKey: configService.jwtConstants.secret,
    });
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  validate(payload: IJwtPayload): User {
    return {};
  }
}
