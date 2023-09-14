import { ApiProperty } from "@nestjs/swagger";
import {
  IsBoolean,
  IsDefined,
  IsEnum,
  IsNotEmpty,
  IsNumber,
  IsObject,
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
  @IsDefined()
  @IsBoolean()
  gradingCallbackRequired: boolean;

  @ApiProperty({
    type: String,
    required: true,
    description:
      "The extra params that will just be embeded to the JWT (Irrelevant to Mark iteself).",
  })
  @IsOptional()
  @IsObject()
  extraParams: object;
}
