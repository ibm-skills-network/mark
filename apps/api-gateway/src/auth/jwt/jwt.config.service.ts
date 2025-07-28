import { Injectable } from "@nestjs/common";

@Injectable()
export class JwtConfigService {
  get jwtConstants() {
    return {
      secret: process.env.SECRET || "devsecret", //pragma: allowlist secret
      signOptions: { expiresIn: "6h" },
    };
  }
}
