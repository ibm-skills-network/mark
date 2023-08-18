export type User = {
  username: string;
  role: "author" | "learner" | "admin";
  assignmentID: number;
};
