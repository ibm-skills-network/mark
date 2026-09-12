import { ApiProperty } from "@nestjs/swagger";
import { IsInt, IsOptional, IsString, MaxLength, Min } from "class-validator";

// GitHub codes and states are short opaque strings; anything longer is not a
// real handoff and must not reach the outbound request.
const MAX_OPAQUE_LENGTH = 512;
const MAX_URL_LENGTH = 2048;

export class GithubOauthUrlDto {
  @ApiProperty()
  @IsInt()
  @Min(1)
  assignmentId: number;

  @ApiProperty()
  @IsString()
  @MaxLength(MAX_URL_LENGTH)
  redirectUrl: string;
}

export class GithubOauthCallbackDto {
  @ApiProperty()
  @IsString()
  @MaxLength(MAX_OPAQUE_LENGTH)
  code: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(MAX_OPAQUE_LENGTH)
  state?: string;
}
