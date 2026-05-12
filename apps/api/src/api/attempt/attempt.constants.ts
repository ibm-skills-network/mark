import { InjectionToken } from "@nestjs/common";
import type { GradingProgressService } from "./services/grading-progress.service";

export const GRADING_AUDIT_SERVICE = "GRADING_AUDIT_SERVICE";
export const GRADING_CONSISTENCY_SERVICE = "GRADING_CONSISTENCY_SERVICE";
export const GRADING_PROGRESS_SERVICE =
  new InjectionToken<GradingProgressService>("GradingProgressService");
export const ATTEMPT_VALIDATION_SERVICE = "ATTEMPT_VALIDATION_SERVICE";
export const FILE_CONTENT_EXTRACTION_SERVICE =
  "FILE_CONTENT_EXTRACTION_SERVICE";
