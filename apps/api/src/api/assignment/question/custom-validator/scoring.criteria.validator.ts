import { QuestionType } from "@prisma/client";
import {
  ValidationArguments,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from "class-validator";
import { ScoringDto } from "../../dto/update.questions.request.dto";
import {
  CreateUpdateQuestionRequestDto,
  ScoringType,
} from "../dto/create.update.question.request.dto";

@ValidatorConstraint({ async: false })
export class CustomScoringValidator implements ValidatorConstraintInterface {
  validate(scoring: ScoringDto | null, arguments_: ValidationArguments) {
    const dto: CreateUpdateQuestionRequestDto =
      arguments_.object as CreateUpdateQuestionRequestDto;
    const totalPoints = dto.totalPoints;

    if (dto.type === QuestionType.TRUE_FALSE) {
      return false;
    }

    if (!scoring) {
      arguments_.constraints[0] = "Scoring cannot be null.";
      return false;
    }

    const scoringType: ScoringType = scoring.type;
    const rubrics = scoring.rubrics;

    if (
      (rubrics === null && scoringType !== ScoringType.AI_GRADED) ||
      (rubrics !== null && rubrics.length === 0)
    ) {
      arguments_.constraints[0] =
        "Rubrics cannot be null (except for AI_GRADED scoring type) or empty.";
      return false;
    }

    switch (scoringType) {
      case ScoringType.CRITERIA_BASED: {
        if (!Array.isArray(rubrics) || rubrics.length === 0) {
          arguments_.constraints[0] =
            "Rubrics for CRITERIA_BASED scoring type should be a non-empty array.";
          return false;
        }

        let totalRubricPoints = 0;
        for (const rubric of rubrics) {
          if (
            !rubric.criteria ||
            !Array.isArray(rubric.criteria) ||
            rubric.criteria.length === 0
          ) {
            arguments_.constraints[0] =
              "Each rubric must contain a non-empty array of criteria.";
            return false;
          }

          let rubricTotal = 0;
          for (const criterion of rubric.criteria) {
            if (typeof criterion.points !== "number" || criterion.points < 0) {
              arguments_.constraints[0] =
                "Each criterion must have a valid positive number of points.";
              return false;
            }
            rubricTotal += criterion.points;
          }

          totalRubricPoints += rubricTotal;
        }

        if (totalRubricPoints !== totalPoints) {
          arguments_.constraints[0] = `The total points across all rubrics (${totalRubricPoints}) must be exactly equal to the totalPoints of the question (${totalPoints}).`;
          return false;
        }

        break;
      }

      case ScoringType.LOSS_PER_MISTAKE: {
        if (scoring.rubrics !== null) {
          arguments_.constraints[0] =
            "Rubrics for LOSS_PER_MISTAKE scoring type should be null.";
          return false;
        }
        break;
      }

      case ScoringType.AI_GRADED: {
        if (scoring.rubrics !== null) {
          arguments_.constraints[0] =
            "Rubrics for AI_GRADED scoring type should be null.";
          return false;
        }
        break;
      }
    }

    return true;
  }

  defaultMessage(arguments_: ValidationArguments): string {
    return (arguments_.constraints as string[])[0];
  }
}
