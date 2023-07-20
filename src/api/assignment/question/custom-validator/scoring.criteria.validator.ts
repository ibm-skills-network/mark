import {
  ValidationArguments,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from "class-validator";
import {
  Criteria,
  Scoring,
  ScoringType,
} from "../dto/create.update.question.request.dto";

@ValidatorConstraint({ async: true })
export class CustomScoringValidator implements ValidatorConstraintInterface {
  validate(criteria: Criteria | null, arguments_: ValidationArguments) {
    const scoringType: ScoringType = (arguments_.object as Scoring).type;

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
      case ScoringType.MULTIPLE_CRITERIA: {
        if (typeof criteria !== "object" || criteria === null) {
          arguments_.constraints[0] =
            "criteria for MULTIPLE_CRITERIA scoring type should be an object.";
          return false;
        }

        for (const key in criteria) {
          if (
            typeof key !== "string" ||
            typeof criteria[key] !== "object" ||
            criteria[key] === null
          ) {
            arguments_.constraints[0] = `criteria for MULTIPLE_CRITERIA scoring type should be an object for each category. Check the category "${key}".`;
            return false;
          }

          const nestedObject = criteria[key] as Record<string, unknown>;

          // Check if each nested object is a key-value pair with key as number and value as string
          for (const nestedKey in nestedObject) {
            if (
              Number.isNaN(Number(nestedKey)) ||
              typeof nestedObject[nestedKey] !== "string"
            ) {
              arguments_.constraints[0] = `criteria is invalid. In the category "${key}", each criteria should be a key-value pair with key as number and value as string. Check the criteria "${nestedKey}".`;
              return false;
            }
          }
        }
        break;
      }
      case ScoringType.SINGLE_CRITERIA: {
        if (typeof criteria !== "object" || criteria === null) {
          arguments_.constraints[0] =
            "criteria for SINGLE_CRITERIA scoring type should be an object.";
          return false;
        }
        for (const key in criteria) {
          if (Number.isNaN(Number(key)) || typeof criteria[key] !== "string") {
            arguments_.constraints[0] = `criteria is invalid. In SINGLE_CRITERIA, each key should be a number and each criteria should be a string. Check the criteria "${key}".`;
            return false;
          }
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
