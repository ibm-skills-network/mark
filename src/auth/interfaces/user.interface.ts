export enum UserRole {
  ADMIN = "admin",
  LEARNER = "learner",
  AUTHOR = "author",
}

export interface User {
  username: string;
  role: UserRole;
  groupID: number;
}
