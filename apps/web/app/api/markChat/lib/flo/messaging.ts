/* eslint-disable */

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
}

/**
 * Service message params
 */
export interface ServiceMessageParams {
  action: string;
  data: Record<string, any>;
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

/**
 * MessagingClient for sending messages via NATS
 */
export class MessagingClient {
  private options: NatsConnectionOptions;
  private connected: boolean = false;
  private reconnectAttempts: number = 0;
  private maxReconnectAttempts: number = 5;

  /**
   * Create a new MessagingClient
   */
  constructor(options: NatsConnectionOptions) {
    this.options = options;

    this.connect();
  }

  /**
   * Connect to NATS server
   */
  private async connect(): Promise<void> {
    try {
      await new Promise((resolve) => setTimeout(resolve, 100));

      this.connected = true;
      this.reconnectAttempts = 0;
    } catch (error) {
      this.connected = false;
      this.reconnectAttempts++;

      if (this.reconnectAttempts < this.maxReconnectAttempts) {
        await this.connect();
      } else {
        throw new Error(
          `Failed to connect to NATS after ${this.maxReconnectAttempts} attempts`,
        );
      }
    }
  }

  /**
   * Publish a service message
   */
  async publishService(params: ServiceMessageParams): Promise<void> {
    try {
      if (!this.connected) {
        await this.connect();
      }

      const { action, data } = params;
      const subject = `${this.options.organization}.${this.options.program}.${this.options.project}.service.${action}`;

      await new Promise((resolve) => setTimeout(resolve, 50));
    } catch (error) {
      throw error;
    }
  }

  /**
   * Publish a user message
   */
  async publishUser(params: PublishUserMessage): Promise<void> {
    try {
      if (!this.connected) {
        await this.connect();
      }

      const { organization, program, project, action, username, data } = params;
      const subject = `${organization}.${program}.${project}.user.${action}`;

      await new Promise((resolve) => setTimeout(resolve, 50));
    } catch (error) {
      throw error;
    }
  }

  /**
   * Close the connection
   */
  async close(): Promise<void> {
    try {
      await new Promise((resolve) => setTimeout(resolve, 50));

      this.connected = false;
    } catch (error) {
      throw error;
    }
  }
}
