import { Request } from "express";

export enum UserRole {
  LEARNER = "learner",
  AUTHOR = "author",
  ADMIN = "admin",
}

export interface UserSession {
  userId: string;
  role: UserRole;
  assignmentId: number;
  groupId: string;
  gradingCallbackRequired?: boolean;
  returnUrl?: string;
  /** See `grading.lis_outcome_service_url` on UserSessionPayload. */
  outcomeServiceUrl?: string;
  launch_presentation_locale?: string;
}

export interface UserSessionPayload {
  userID: string;
  role: UserRole;
  assignmentID: number;
  groupID: string;
  gradingCallbackRequired?: boolean;
  returnUrl?: string;
  /**
   * Grade-callback details the lti-gateway mints into the launch JWT. Only
   * `lis_outcome_service_url` is read here, and only for its host: it names
   * the site Mark was launched from, which `returnUrl` does not, because Open
   * edX and Coursera send that claim empty.
   */
  grading?: {
    lis_outcome_service_url?: string;
  };
  launch_presentation_locale?: string;
}

export interface UserSessionRequest extends Request {
  user: UserSession;
}
