import {
  Body,
  Controller,
  Post,
  Req,
  Res,
  UnauthorizedException,
  UseGuards,
} from "@nestjs/common";
import { ThrottlerGuard, Throttle } from "@nestjs/throttler";
import { Request, Response } from "express";
import { AdminOverrideService } from "./admin-override.service";

@Controller({ path: "auth/admin", version: "1" })
@UseGuards(ThrottlerGuard)
export class AdminOverrideController {
  constructor(private readonly svc: AdminOverrideService) {}

  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post("override-session")
  async createOverrideSession(
    @Body() body: { sessionToken?: string },
    @Req() request: Request,
    @Res() response: Response,
  ) {
    const minted = await this.svc.mintOverrideCookie(body?.sessionToken ?? "");
    if (!minted) throw new UnauthorizedException("Not authorized");

    response.cookie("authentication", minted.token, {
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      path: "/",
    });
    return response
      .status(200)
      .json({ success: true, expiresAt: minted.expiresAt });
  }
}
