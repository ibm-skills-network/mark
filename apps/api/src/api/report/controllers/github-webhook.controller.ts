import * as crypto from "node:crypto";
import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  UnauthorizedException,
} from "@nestjs/common";
import { Request } from "express";
import { ReportsService } from "../services/report.service";

interface GitHubIssueCommentPayload {
  action?: string;
  issue?: { number?: number };
  comment?: {
    body?: string;
    user?: { login?: string };
  };
}

type RawBodyRequest = Request & { rawBody?: Buffer };

@Controller({
  path: "reports/github",
  version: "1",
})
export class GithubWebhookController {
  constructor(private readonly reportsService: ReportsService) {}

  private verifySignature(rawBody: string, signature?: string): boolean {
    const secret = process.env.GITHUB_WEBHOOK_SECRET; // pragma: allowlist secret
    if (!secret || !signature) return false;
    const hmac = crypto.createHmac("sha256", secret);
    const digest = `sha256=${hmac.update(rawBody).digest("hex")}`;
    try {
      return crypto.timingSafeEqual(
        Buffer.from(digest, "utf8"),
        Buffer.from(signature, "utf8"),
      );
    } catch {
      return false;
    }
  }

  @Post("webhook")
  @HttpCode(HttpStatus.NO_CONTENT)
  async handleWebhook(
    @Body() body: GitHubIssueCommentPayload,
    @Req() request: RawBodyRequest,
  ) {
    const bodyBuffer = Buffer.isBuffer(request.body)
      ? request.body
      : request.rawBody instanceof Buffer
        ? request.rawBody
        : null;

    const raw = bodyBuffer ? bodyBuffer.toString() : JSON.stringify(body);

    const signatureHeader = request.headers["x-hub-signature-256"];
    const signature = Array.isArray(signatureHeader)
      ? signatureHeader[0]
      : signatureHeader;

    if (!this.verifySignature(raw, signature)) {
      throw new UnauthorizedException("Invalid webhook signature");
    }

    const eventHeader = request.headers["x-github-event"];
    const event = Array.isArray(eventHeader) ? eventHeader[0] : eventHeader;
    if (event !== "issue_comment") {
      return;
    }

    const action = body?.action;
    const issueNumber = body?.issue?.number;
    const commentBody = body?.comment?.body;
    const commenter = body?.comment?.user?.login;

    if (action !== "created" || !issueNumber || !commentBody) {
      return;
    }

    await this.reportsService.handleIncomingGitHubComment(
      Number(issueNumber),
      commentBody,
      commenter ?? "github-user",
    );
  }
}
