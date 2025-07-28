export class ReportIssueDto {
  issueType: string;
  description: string;
  assignmentId?: number;
  attemptId?: number;
  severity?: "info" | "warning" | "error" | "critical";
  role?: string;
  category?: string;
  portalName?: string;
  userEmail?: string;
  additionalDetails?: Record<string, any>;
}

export class RegradeRequestDto {
  assignmentId: number;
  attemptId: number;
  reason: string;
  userEmail?: string;
  role?: "author" | "learner";
}

export class UserFeedbackDto {
  title: string;
  description: string;
  rating: string;
  userEmail?: string;
  portalName?: string;
}

export type IssueSeverity = "info" | "warning" | "error" | "critical";

export interface IssueReportResult {
  message: string;
  issueNumber?: number;
  success: boolean;
}
/**
 * Messaging utilities for integration with NATS
 */

/**
 * NATS Server configuration options
 */
export enum SkillsNetworkNatsServer {
  STAGING = "nats://nats.staging.skills.network:4222",
  PRODUCTION = "nats://nats.skills.network:4222",
}

/**
 * NATS Connection options
 */
export interface NatsConnectionOptions {
  user: string;
  pass: string;
  organization: string;
  program: string;
  project: string;
  servers: string[];
  tls: {
    rejectUnauthorized: boolean;
  };
}

/**
 * User message params
 */
export interface PublishUserMessage {
  action: string;
  username: string;
  data: Record<string, any>;
  organization: string;
  program: string;
  project: string;
}

/**
 * Default organization
 */
export const DEFAULT_ORG = "sn";

/**
 * Error severity levels
 */
export enum ErrorSeverity {
  INFO = "info",
  WARNING = "warning",
  ERROR = "error",
  CRITICAL = "critical",
}
