import { ApiProperty } from "@nestjs/swagger";
import { AssignmentType } from "@prisma/client";
import { IsDefined, IsEnum, IsString } from "class-validator";

export class UpdateAssignmentRequestDto {
  @ApiProperty({
    description: "The name of the assignment.",
    type: String,
    required: true,
  })
  @IsDefined()
  @IsString()
  name: string;
}

export class CreateAssignmentRequestDto extends UpdateAssignmentRequestDto {
  @ApiProperty({
    description: "The ID of the group that the assignment belongs to.",
    type: String,
    required: true,
  })
  @IsDefined()
  @IsString()
  groupID: string;

  @ApiProperty({
    description: "The type of the assignment.",
    required: false,
    enum: AssignmentType,
  })
  @IsDefined()
  @IsEnum(AssignmentType)
  type: AssignmentType;
}
