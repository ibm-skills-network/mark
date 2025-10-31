import { ApiProperty } from "@nestjs/swagger";

export class SuccessPageQuestionDto {
  @ApiProperty()
  id: number;

  @ApiProperty()
  number: number;

  @ApiProperty()
  question: string;

  @ApiProperty()
  type: string;

  @ApiProperty()
  totalPoints: number;

  @ApiProperty()
  earnedPoints: number;

  @ApiProperty()
  learnerResponse?: any;

  @ApiProperty()
  choices?: any[];

  @ApiProperty()
  correctAnswer?: any;

  @ApiProperty()
  feedback?: string;

  @ApiProperty()
  scoring?: any;
}

export class SuccessPageDataDto {
  @ApiProperty()
  assignmentId: number;

  @ApiProperty()
  assignmentName: string;

  @ApiProperty()
  isAuthor: boolean;

  @ApiProperty()
  grade: number;

  @ApiProperty()
  totalPointsEarned: number;

  @ApiProperty()
  totalPointsPossible: number;

  @ApiProperty()
  passingGrade: number;

  @ApiProperty()
  passed: boolean;

  @ApiProperty()
  showQuestions: boolean;

  @ApiProperty()
  showSubmissionFeedback: boolean;

  @ApiProperty()
  correctAnswerVisibility: "NEVER" | "ALWAYS" | "ON_PASS";

  @ApiProperty()
  comments?: string;

  @ApiProperty()
  preferredLanguage: string;

  @ApiProperty({ type: [SuccessPageQuestionDto] })
  questions: SuccessPageQuestionDto[];
}
