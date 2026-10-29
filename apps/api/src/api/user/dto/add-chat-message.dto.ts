import { ChatRole } from "@prisma/client";
import { Equals, IsString, MaxLength } from "class-validator";

export class AddChatMessageDto {
  @Equals(ChatRole.USER, {
    message: "Only USER role messages may be submitted via this endpoint.",
  })
  role!: ChatRole;

  @IsString()
  @MaxLength(64 * 1024)
  content!: string;
}
