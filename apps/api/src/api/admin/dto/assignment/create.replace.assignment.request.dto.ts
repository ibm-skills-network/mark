import { ApiProperty } from "@nestjs/swagger";
import { AssignmentType } from "@prisma/client";
import { Type } from "class-transformer";
import { IsDefined, IsEnum, IsString, ValidateNested } from "class-validator";
import { QuestionDto } from "src/api/assignment/dto/update.questions.request.dto";

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
  @IsDefined()
  @IsString()
  groupId: string;

  // published 
  @ApiProperty({
    description: "The published status of the assignment.",
    type: Boolean,
    required: false,
  })
  @IsDefined()
  @IsString()
  published: boolean;

  // questions
    @ApiProperty({
      description: "Question object",
      type: QuestionDto,
    })
    @ValidateNested()
    @Type(() => QuestionDto)
    questions: QuestionDto[];
}
