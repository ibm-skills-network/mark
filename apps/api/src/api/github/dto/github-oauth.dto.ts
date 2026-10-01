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
  @MaxLength(4096)
  state?: string;
}

/** The fixed web callback forwards either a code or GitHub's denial. */
export class GithubOauthCompleteDto {
  @IsOptional()
  @IsString()
  @MaxLength(MAX_OPAQUE_LENGTH)
  code?: string;

  @IsString()
  @MaxLength(4096)
  state: string;

  @IsOptional()
  @IsString()
  @MaxLength(MAX_OPAQUE_LENGTH)
  error?: string;
}
