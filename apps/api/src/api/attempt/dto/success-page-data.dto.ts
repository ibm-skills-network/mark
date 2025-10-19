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
  learnerResponse?: any; // The actual response given by the user

  @ApiProperty()
  choices?: any[]; // For multiple choice questions

  @ApiProperty()
  correctAnswer?: any; // Only included if visibility allows

  @ApiProperty()
  feedback?: string; // AI/instructor feedback

  @ApiProperty()
  scoring?: any; // Rubric info if needed
}

export class SuccessPageDataDto {
  @ApiProperty()
  assignmentId: number;

  @ApiProperty()
  assignmentName: string;

  @ApiProperty()
  isAuthor: boolean;

  @ApiProperty()
  grade: number; // Percentage (0-100)

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
  comments?: string; // Instructor comments

  @ApiProperty()
  preferredLanguage: string;

  @ApiProperty({ type: [SuccessPageQuestionDto] })
  questions: SuccessPageQuestionDto[];
}
