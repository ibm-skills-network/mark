import { Controller, HttpStatus, Inject, Post, Req, Res } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import axios from "axios";
import { Request, Response } from "express";
import { sign } from "jsonwebtoken";
import { WINSTON_MODULE_PROVIDER } from "nest-winston";
import { Logger } from "winston";
import { JwtConfigService } from "../auth/jwt/jwt.config.service";

const ASSUMED_SESSION_TTL_SECONDS = 2 * 60 * 60;
const ASSUMABLE_ROLES = new Set(["learner", "author"]);

interface AssumeRoleBody {
  assignmentId: number;
  role: "learner" | "author";
}

function parseBody(body: unknown): AssumeRoleBody | undefined {
  if (!body || typeof body !== "object") return undefined;
  const { assignmentId, role } = body as Record<string, unknown>;
  if (
    typeof assignmentId !== "number" ||
    !Number.isSafeInteger(assignmentId) ||
    assignmentId <= 0 ||
    typeof role !== "string" ||
    !ASSUMABLE_ROLES.has(role)
  ) {
    return undefined;
  }
  return { assignmentId, role: role as AssumeRoleBody["role"] };
}

function headerValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/**
 * Lets a Mark admin replace their session cookie with a learner or author
 * session for any assignment. No cookie session is required: the admin token
 * (x-admin-token) is checked by mark-api, which also picks the group and
 * records the admin as an author. This gateway only signs what mark-api
 * returned, because it is the only service that holds the session secret.
 */
@ApiTags("Admin Authentication")
@Controller({ version: "1" })
export class AdminAssumeRoleController {
  private readonly logger: Logger;

  constructor(
    private readonly jwtConfigService: JwtConfigService,
    @Inject(WINSTON_MODULE_PROVIDER) parentLogger: Logger,
  ) {
    this.logger = parentLogger.child({
      context: AdminAssumeRoleController.name,
    });
  }

  @Post("auth/admin/assume-role")
  @ApiOperation({
    summary:
      "Replace the session cookie with an admin-issued learner or author session",
  })
  async assumeRole(@Req() request: Request, @Res() response: Response) {
    const adminToken =
      headerValue(request.headers["x-admin-token"]) ??
      headerValue(request.headers["admin-token"]);
    const body = parseBody(request.body);

    if (!adminToken || !body) {
      this.logger.warn("admin_assume_role_rejected: malformed request", {
        has_admin_token: Boolean(adminToken),
        valid_body: Boolean(body),
      });
      return response
        .status(adminToken ? HttpStatus.BAD_REQUEST : HttpStatus.UNAUTHORIZED)
        .json({ message: adminToken ? "Invalid request" : "Unauthorized" });
    }

    const endpoint = `${process.env.MARK_API_ENDPOINT ?? ""}/api/v1/auth/admin/assume-role`;
    let upstream;
    try {
      upstream = await axios.post<unknown>(endpoint, body, {
        headers: {
          "content-type": "application/json",
          "x-admin-token": adminToken,
          ...(request.headers["true-client-ip"]
            ? { "true-client-ip": request.headers["true-client-ip"] }
            : {}),
        },
        timeout: 10_000,
        validateStatus: () => true,
      });
    } catch (error) {
      this.logger.error("admin_assume_role_upstream_error", {
        assignment_id: body.assignmentId,
        role: body.role,
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      });
      return response
        .status(HttpStatus.BAD_GATEWAY)
        .json({ message: "Could not switch session" });
    }

    if (upstream.status < 200 || upstream.status >= 300) {
      this.logger.warn("admin_assume_role_denied_upstream", {
        assignment_id: body.assignmentId,
        role: body.role,
        upstream_status: upstream.status,
      });
      const status =
        upstream.status === 401 ||
        upstream.status === 403 ||
        upstream.status === 404 ||
        upstream.status === 400 ||
        upstream.status === 429
          ? upstream.status
          : HttpStatus.BAD_GATEWAY;
      return response
        .status(status)
        .json({ message: "Could not switch session" });
    }

    const claims = upstream.data as Record<string, unknown> | null;
    if (
      !claims ||
      typeof claims.userId !== "string" ||
      claims.userId.length === 0 ||
      claims.role !== body.role ||
      claims.assignmentId !== body.assignmentId ||
      typeof claims.groupId !== "string" ||
      claims.groupId.length === 0
    ) {
      this.logger.error("admin_assume_role_bad_upstream_claims", {
        assignment_id: body.assignmentId,
        role: body.role,
      });
      return response
        .status(HttpStatus.BAD_GATEWAY)
        .json({ message: "Could not switch session" });
    }

    const token = sign(
      {
        userID: claims.userId,
        role: body.role,
        assignmentID: body.assignmentId,
        groupID: claims.groupId,
        gradingCallbackRequired: false,
      },
      this.jwtConfigService.jwtConstants.secret,
      { expiresIn: ASSUMED_SESSION_TTL_SECONDS },
    );

    response.cookie("authentication", token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: ASSUMED_SESSION_TTL_SECONDS * 1000,
    });

    this.logger.info("admin_assume_role_session_issued", {
      admin_email: claims.userId,
      assignment_id: body.assignmentId,
      group_id: claims.groupId,
      role: body.role,
    });

    return response.status(HttpStatus.OK).json({
      role: body.role,
      assignmentId: body.assignmentId,
      expiresAt: new Date(
        Date.now() + ASSUMED_SESSION_TTL_SECONDS * 1000,
      ).toISOString(),
    });
  }
}
