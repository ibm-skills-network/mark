export enum UserRole {
  ADMIN = "admin",
  LEARNER = "learner",
  AUTHOR = "author",
}

export interface ClientUser {
  username: string;
  role: UserRole;
  assignmentID: number;
}

export interface User extends ClientUser {
  groupID: string;
}

export interface UserRequest extends Request {
  user: User;
}
