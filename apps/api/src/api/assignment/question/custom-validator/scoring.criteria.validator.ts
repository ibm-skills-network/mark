import { QuestionType } from "@prisma/client";
import {
  ValidationArguments,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from "class-validator";
import {
  CreateUpdateQuestionRequestDto,
  Criteria,
  Scoring,
  ScoringType,
} from "../dto/create.update.question.request.dto";

type CriteriaBasedType = {
  criteria: string;
  performanceDescription: string;
  maxPoints: number;
};

@ValidatorConstraint({ async: false })
export class CustomScoringValidator implements ValidatorConstraintInterface {
  validate(scoring: Scoring | null, arguments_: ValidationArguments) {
    const dto: CreateUpdateQuestionRequestDto =
      arguments_.object as CreateUpdateQuestionRequestDto;
    const totalPoints = dto.totalPoints;

    // No validation needed because scoring is not required for TRUE/FALSE questions
    if (dto.type === QuestionType.TRUE_FALSE) {
      return false;
    }

    // Scoring cannot be null otherwise
    if (!scoring) {
      arguments_.constraints[0] = "Scoring cannot be null.";
      return false;
    }

    const scoringType: ScoringType = scoring.type;
    const criteria = scoring.criteria;

    // Criteria can't be null except for AI_GRADED and shouldn't be empty
    if (
      (criteria === null && scoringType !== ScoringType.AI_GRADED) ||
      (criteria !== null && Object.keys(criteria).length === 0)
    ) {
      arguments_.constraints[0] =
        "criteria cannot be null (except for AI_GRADED scoring type) or empty.";
      return false;
    }

    switch (scoringType) {
      case ScoringType.CRITERIA_BASED: {
        let totalMaxPoints = 0;
        if (!Array.isArray(criteria) || criteria.length === 0) {
          arguments_.constraints[0] =
            "criteria for CRITERIA_BASED scoring type should be a non-empty array.";
          return false;
        }

        for (const criterion of criteria as CriteriaBasedType[]) {
          if (typeof criterion !== "object" || criterion === null) {
            arguments_.constraints[0] =
              "Each item in the criteria array should be an object.";
            return false;
          }

          if (
            !criterion["criteria"] ||
            !criterion["performanceDescription"] ||
            criterion["maxPoints"] === undefined
          ) {
            arguments_.constraints[0] =
              "Each criterion object should have all three fields: criteria, performanceDescription, and maxPoints.";
            return false;
          }

          if (typeof criterion["criteria"] !== "string") {
            arguments_.constraints[0] =
              "Each criterion in the criteria array should have a 'criteria' field of type string.";
            return false;
          }

          if (typeof criterion["performanceDescription"] !== "string") {
            arguments_.constraints[0] =
              "Each criterion in the criteria array should have a 'performanceDescription' field of type string.";
            return false;
          }

          if (typeof criterion["maxPoints"] !== "number") {
            arguments_.constraints[0] =
              "Each criterion in the criteria array should have a 'maxPoints' field of type number.";
            return false;
          }

          totalMaxPoints += criterion["maxPoints"];
        }

        if (totalMaxPoints !== totalPoints) {
          arguments_.constraints[0] = `The sum of maxPoints in criteria should exactly add up to ${totalPoints}.`;
          return false;
        }

        break;
      }
      case ScoringType.LOSS_PER_MISTAKE: {
        if (
          typeof criteria !== "object" ||
          criteria === null ||
          Object.keys(criteria).length !== 1 ||
          typeof criteria["loss_per_mistake"] !== "number"
        ) {
          arguments_.constraints[0] =
            "criteria for LOSS_PER_MISTAKE scoring type should be an object with a single key 'loss_per_mistake' and the value should be a number.";
          return false;
        }
        break;
      }
      case ScoringType.AI_GRADED: {
        if (criteria !== null) {
          arguments_.constraints[0] =
            "criteria for AI_GRADED scoring type should be null.";
          return false;
        }
        break;
      }
    }

    return true;
  }

  defaultMessage(arguments_: ValidationArguments) {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-return
    return arguments_.constraints[0];
  }
}
