import { Request } from "express";

export enum UserRole {
  LEARNER = "learner",
  AUTHOR = "author",
}

export interface UserSession {
  userID: string;
  role: UserRole;
  assignmentID: number;
  groupID: string;
  gradingCallbackRequired?: boolean;
}

export interface UserSessionRequest extends Request {
  user: UserSession;
}
