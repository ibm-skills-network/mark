import { ApiProperty } from "@nestjs/swagger";
import { AssignmentType } from "@prisma/client";
import { IsDefined, IsEnum, IsOptional, IsString } from "class-validator";

export class AdminReplaceAssignmentRequestDto {
  @ApiProperty({
    description: "The name of the assignment.",
    type: String,
    required: true,
  })
  @IsDefined()
  @IsString()
  name: string;

  @ApiProperty({
    description: "The type of the assignment.",
    required: false,
    enum: AssignmentType,
  })
  @IsDefined()
  @IsEnum(AssignmentType)
  type: AssignmentType;
}

export class AdminCreateAssignmentRequestDto extends AdminReplaceAssignmentRequestDto {
  @ApiProperty({
    description: "The Id of the group that the assignment belongs to.",
    type: String,
    required: true,
  })
  @IsString()
  @IsOptional()
  groupId?: string;
}
