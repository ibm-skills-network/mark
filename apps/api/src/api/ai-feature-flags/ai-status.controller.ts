import { Controller, Get, Injectable } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import { AiFeatureFlagsService } from "./ai-feature-flags.service";

/**
 * Read-only view of which AI components are currently enabled, so the web
 * client can proactively hide the chat widget and pre-disable the "Start" CTA
 * on AI-graded assignments. The server still enforces every gate independently
 * — this endpoint is a UX hint, not a security boundary.
 *
 * Deliberately public (no `@Roles`): the `UserSessionMiddleware` is not applied
 * to this path, so no session is available to authorize against, and the
 * payload contains no secrets — only three booleans.
 */
@ApiTags("AI Status")
@Injectable()
@Controller({ path: "ai-status", version: "1" })
export class AiStatusController {
  constructor(private readonly aiFlags: AiFeatureFlagsService) {}

  @Get()
  @ApiOperation({ summary: "Get the enabled/disabled state of AI components" })
  getStatus(): { grading: boolean; chat: boolean; authoring: boolean } {
    return this.aiFlags.getStatus();
  }
}
