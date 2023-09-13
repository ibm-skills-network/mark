import { ApiProperty } from "@nestjs/swagger";
import {
  IsDefined,
  IsEnum,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
} from "class-validator";
import { UserRole } from "../../../auth/interfaces/user.interface";

export class CreateTokenRequestDto {
  @ApiProperty({
    type: String,
    required: true,
    description: "The unique identifier for the user.",
  })
  @IsDefined()
  @IsString()
  @IsNotEmpty()
  userID: string;

  @ApiProperty({
    enum: UserRole,
    required: true,
    description: "The role of the user.",
  })
  @IsDefined()
  @IsEnum(UserRole)
  @IsNotEmpty()
  role: UserRole;

  @ApiProperty({
    type: String,
    required: true,
    description: "The unique identifier for the group.",
  })
  @IsDefined()
  @IsNotEmpty()
  @IsString()
  groupID: string;

  @ApiProperty({
    type: Number,
    required: true,
    description: "The unique identifier for the assignment.",
  })
  @IsDefined()
  @IsNumber()
  @IsNotEmpty()
  assignmentID: number;

  // Grading related fields

  @ApiProperty({
    type: String,
    required: true,
    description: "The callback url for sending grades back to.",
  })
  @IsOptional()
  @IsString()
  lis_outcome_service_url?: string;

  @ApiProperty({
    type: String,
    required: true,
    description: "Extra field required for grading.",
  })
  @IsDefined()
  @IsNotEmpty()
  @IsString()
  oauth_consumer_key: string;

  @ApiProperty({
    type: String,
    required: true,
    description: "Extra field required for grading.",
  })
  @IsOptional()
  @IsString()
  lis_result_sourcedid?: string;

  @ApiProperty({
    type: String,
    required: true,
    description: "Extra field required for grading.",
  })
  @IsDefined()
  @IsNotEmpty()
  @IsString()
  toolServiceName: string;
}
