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
  launch_presentation_locale?: string;
}

export interface UserSessionPayload {
  userID: string;
  role: UserRole;
  assignmentID: number;
  groupID: string;
  gradingCallbackRequired?: boolean;
  returnUrl?: string;
  launch_presentation_locale?: string;
}

export interface UserSessionRequest extends Request {
  user: UserSession;
}
