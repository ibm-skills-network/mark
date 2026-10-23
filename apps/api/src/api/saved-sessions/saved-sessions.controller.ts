import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Headers,
  HttpCode,
  Post,
  Put,
} from "@nestjs/common";
import { timingSafeEqual } from "node:crypto";
import { getJobQueueSecret } from "../../job-queue/job-payload.crypto";
import {
  SavedSessionKey,
  SavedSessionsService,
} from "./saved-sessions.service";

const MAX_ASSIGNMENT_ID = 2_147_483_647;
const MAX_TOKEN_LENGTH = 16_384;
const STORE_ID = /^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/i;

function parseKey(body: unknown): SavedSessionKey {
  const { storeId, role, assignmentId } = (body ?? {}) as Record<
    string,
    unknown
  >;
  if (
    typeof storeId !== "string" ||
    !STORE_ID.test(storeId) ||
    (role !== "author" && role !== "learner") ||
    typeof assignmentId !== "number" ||
    !Number.isInteger(assignmentId) ||
    assignmentId < 1 ||
    assignmentId > MAX_ASSIGNMENT_ID
  ) {
    throw new BadRequestException("Invalid saved session key");
  }
  return { storeId, role, assignmentId };
}

@Controller("internal/saved-sessions")
export class SavedSessionsController {
  constructor(private readonly savedSessions: SavedSessionsService) {}

  @Post("lookup")
  @HttpCode(200)
  async lookup(
    @Headers("x-job-queue-secret") secretHeader: string | string[] | undefined,
    @Body() body: unknown,
  ): Promise<{ token: string | null }> {
    this.authorize(secretHeader);
    const token = await this.savedSessions.find(parseKey(body));
    // eslint-disable-next-line unicorn/no-null
    return { token: token ?? null };
  }

  @Put()
  @HttpCode(204)
  async save(
    @Headers("x-job-queue-secret") secretHeader: string | string[] | undefined,
    @Body() body: unknown,
  ): Promise<void> {
    this.authorize(secretHeader);
    const key = parseKey(body);
    const { token } = body as Record<string, unknown>;
    if (
      typeof token !== "string" ||
      token.length === 0 ||
      token.length > MAX_TOKEN_LENGTH
    ) {
      throw new BadRequestException("Invalid saved session token");
    }
    await this.savedSessions.save(key, token);
  }

  private authorize(secretHeader: string | string[] | undefined): void {
    const providedSecret = Array.isArray(secretHeader)
      ? secretHeader[0]
      : secretHeader;
    const expected = Buffer.from(getJobQueueSecret());
    const provided = Buffer.from(providedSecret ?? "");
    if (
      provided.length !== expected.length ||
      !timingSafeEqual(provided, expected)
    ) {
      throw new ForbiddenException("Invalid job queue secret");
    }
  }
}
