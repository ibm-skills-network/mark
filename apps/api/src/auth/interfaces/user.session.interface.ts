import { Request } from "express";

export enum UserRole {
  LEARNER = "learner",
  AUTHOR = "author",
  ADMIN = "admin",
}

export interface ClientUserSession {
  userId: string;
  role: UserRole;
  assignmentId: number;
  returnUrl?: string;
  launch_presentation_locale?: string;
  sessionToken?: string;
  lmsHost?: string;
}

export interface UserSession extends ClientUserSession {
  groupId: string;
  gradingCallbackRequired?: boolean;
  /** Grade callback endpoint; only its host is exposed to the browser. */
  lisOutcomeServiceUrl?: string;
  /** LTI tool_consumer_instance_guid, e.g. "ondemand.coursera.org". */
  toolConsumerInstanceGuid?: string;
  /** LMS course title (LTI context_title) from the signed launch. */
  courseTitle?: string;
}

export interface UserSessionRequest extends Request {
  userSession: UserSession;
}
