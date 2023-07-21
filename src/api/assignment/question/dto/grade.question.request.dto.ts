import { ApiPropertyOptional } from "@nestjs/swagger";
import { IsArray, IsNotEmpty, IsString, ValidateIf } from "class-validator";

export class GradeQuestionRequestDto {
  @ApiPropertyOptional({ description: "The learner response.", type: String })
  @IsString()
  // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
  @ValidateIf((o) => !o.learnerChoices)
  @IsNotEmpty()
  learnerResponse: string;

  @ApiPropertyOptional({ description: "The learner choices.", type: [String] })
  @IsArray()
  // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
  @ValidateIf((o) => !o.learnerResponse)
  @IsNotEmpty()
  learnerChoices: string[];
}
