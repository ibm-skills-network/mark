import { Request } from "express";

export enum UserRole {
  LEARNER = "learner",
  AUTHOR = "author",
}

export interface ClientUser {
  userID: string;
  role: UserRole;
  assignmentID: number;
}

export interface User extends ClientUser {
  groupID: string;
  gradingCallbackRequired?: boolean;
}

export interface UserRequest extends Request {
  user: User;
}
