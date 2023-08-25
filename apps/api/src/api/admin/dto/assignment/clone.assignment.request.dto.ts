import { ApiProperty } from "@nestjs/swagger";
import { IsDefined, IsNotEmpty, IsString } from "class-validator";

export class AdminAssignmentCloneRequestDto {
  @ApiProperty({
    description:
      "The groupID with which to associate the new cloned assignment",
    required: true,
    type: String,
  })
  @IsDefined()
  @IsString()
  @IsNotEmpty()
  groupID: string;
}
