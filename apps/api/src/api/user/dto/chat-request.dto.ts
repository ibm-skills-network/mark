import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsPositive,
  IsString,
  MaxLength,
} from "class-validator";

/**
 * Roles a chat client is allowed to name. A client may still send one — the
 * browser has always put its own view of the role in the body — but the value
 * is only ever compared against the session, never used to decide what the
 * caller gets. See `MarkChatService.resolveChatRole`.
 */
export const CHAT_CLIENT_ROLES = ["author", "learner"] as const;

export type ChatClientRole = (typeof CHAT_CLIENT_ROLES)[number];

const MAX_USER_TEXT_CHARS = 64 * 1024;
const MAX_CONVERSATION_MESSAGES = 1000;

/**
 * Identity fields older clients send when opening a chat. Accepted so the
 * request is not rejected outright, ignored when the chat is opened.
 */
export class OpenChatDto {
  @IsOptional()
  @IsString()
  @MaxLength(320)
  userId?: string;

  @IsOptional()
  @IsInt()
  @IsPositive()
  assignmentId?: number;
}

export class RespondChatDto {
  @IsOptional()
  @IsIn(CHAT_CLIENT_ROLES)
  userRole?: ChatClientRole;

  @IsString()
  @IsNotEmpty()
  @MaxLength(MAX_USER_TEXT_CHARS)
  userText!: string;

  @IsArray()
  @ArrayMaxSize(MAX_CONVERSATION_MESSAGES)
  conversation!: {
    role: "system" | "user" | "assistant";
    content: string;
    id?: string;
  }[];
}
