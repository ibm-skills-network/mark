import { Request } from "express";

export enum UserRole {
  LEARNER = "learner",
  AUTHOR = "author",
}

export interface ClientUserSession {
  userID: string;
  role: UserRole;
  assignmentID: number;
}

export interface UserSession extends ClientUserSession {
  groupID: string;
  gradingCallbackRequired?: boolean;
}

export interface UserSessionRequest extends Request {
  userSession: UserSession;
}
