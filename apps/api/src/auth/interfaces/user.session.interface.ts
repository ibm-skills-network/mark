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
  lisOutcomeServiceUrl?: string;
}

export interface UserSessionRequest extends Request {
  userSession: UserSession;
}
