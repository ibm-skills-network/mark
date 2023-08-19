import { ApiPropertyOptional } from "@nestjs/swagger";
import {
  IsArray,
  IsBoolean,
  IsNotEmpty,
  IsString,
  ValidateIf,
} from "class-validator";

export class CreateQuestionResponseSubmissionRequestDto {
  @ApiPropertyOptional({
    description: "The learner's response (for text based questions).",
    type: String,
  })
  @IsString()
  // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
  @ValidateIf((o) => !o.learnerChoices && !o.learnerAnswerChoice)
  @IsNotEmpty()
  learnerResponse: string;

  @ApiPropertyOptional({
    description: "The learner's choices (for choice based questions).",
    type: [String],
  })
  @IsArray()
  // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
  @ValidateIf((o) => !o.learnerResponse && !o.learnerAnswerChoice)
  @IsNotEmpty()
  learnerChoices: string[];

  @ApiPropertyOptional({
    description: "The learner's answer choice (for true false questions).",
    type: Boolean,
  })
  @IsBoolean()
  // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
  @ValidateIf((o) => !o.learnerResponse && !o.learnerChoices)
  @IsNotEmpty()
  learnerAnswerChoice: boolean;
}
