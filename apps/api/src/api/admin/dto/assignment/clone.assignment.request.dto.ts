import { ApiProperty } from "@nestjs/swagger";
import { IsDefined, IsNotEmpty, IsString } from "class-validator";

export class AdminAssignmentCloneRequestDto {
  @ApiProperty({
    description:
      "The groupId with which to associate the new cloned assignment",
    required: true,
    type: String,
  })
  @IsDefined()
  @IsString()
  @IsNotEmpty()
  groupId: string;
}
