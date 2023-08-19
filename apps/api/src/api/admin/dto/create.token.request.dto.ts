import { ApiProperty } from "@nestjs/swagger";
import { IsDefined, IsEnum, IsNotEmpty, IsString } from "class-validator";
import { UserRole } from "../../../auth/interfaces/user.interface";

export class CreateTokenRequestDto {
  @ApiProperty()
  @IsDefined()
  @IsString()
  @IsNotEmpty()
  userID: string;

  @ApiProperty()
  @IsDefined()
  @IsEnum(UserRole)
  @IsNotEmpty()
  role: UserRole;

  @ApiProperty()
  @IsDefined()
  @IsNotEmpty()
  @IsString()
  groupID: string;

  @ApiProperty()
  @IsDefined()
  @IsNotEmpty()
  assignmentID: number;
}
