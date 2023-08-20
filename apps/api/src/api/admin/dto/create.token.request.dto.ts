import { ApiProperty } from "@nestjs/swagger";
import { IsDefined, IsEnum, IsNotEmpty, IsString } from "class-validator";
import { UserRole } from "../../../auth/interfaces/user.interface";

export class CreateTokenRequestDto {
  @ApiProperty({
    type: "string",
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
    type: "string",
    required: true,
    description: "The unique identifier for the group.",
  })
  @IsDefined()
  @IsNotEmpty()
  @IsString()
  groupID: string;

  @ApiProperty({
    type: "number",
    required: true,
    description: "The unique identifier for the assignment.",
  })
  @IsDefined()
  @IsNotEmpty()
  assignmentID: number;
}
