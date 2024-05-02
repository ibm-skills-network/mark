import { Request } from "express";

export enum UserRole {
  LEARNER = "learner",
  AUTHOR = "author",
}

export interface ClientUserSession {
  userId: string;
  role: UserRole;
  assignmentId: number;
  returnUrl?: string;
}

export interface UserSession extends ClientUserSession {
  groupId: string;
  gradingCallbackRequired?: boolean;
}

export interface UserSessionRequest extends Request {
  userSession: UserSession;
}
