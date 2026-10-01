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
}

export interface UserSession extends ClientUserSession {
  groupId: string;
  gradingCallbackRequired?: boolean;
  /**
   * Where the grade callback posts (LTI `lis_outcome_service_url`). Present on
   * every launch, unlike `returnUrl`, which Open edX and Coursera send empty —
   * so this is the only portal identity available for most traffic.
   *
   * Deliberately not on ClientUserSession: it is a server-to-server callback
   * endpoint and has no reason to reach the browser. It is also not a page, so
   * use it for its host only, never as a link shown to anyone.
   */
  outcomeServiceUrl?: string;
}

export interface UserSessionRequest extends Request {
  userSession: UserSession;
}
