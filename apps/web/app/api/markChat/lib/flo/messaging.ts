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

    // In a real implementation, we would establish a NATS connection here
    this.connect();
  }

  /**
   * Connect to NATS server
   */
  private async connect(): Promise<void> {
    try {
      // In a real implementation, this would connect to NATS
      // For this example, we'll just simulate a successful connection
      console.log(`[NATS] Connecting to ${this.options.servers.join(", ")}`);

      // Simulate connection delay
      await new Promise((resolve) => setTimeout(resolve, 100));

      this.connected = true;
      this.reconnectAttempts = 0;
      console.log(`[NATS] Connected successfully`);
    } catch (error) {
      console.error(`[NATS] Connection error:`, error);
      this.connected = false;
      this.reconnectAttempts++;

      if (this.reconnectAttempts < this.maxReconnectAttempts) {
        console.log(
          `[NATS] Reconnect attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts}`,
        );
        await this.connect();
      } else {
        console.error(`[NATS] Max reconnect attempts reached`);
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

      // In a real implementation, this would publish to NATS
      console.log(
        `[NATS] Publishing to ${subject}:`,
        JSON.stringify(data, null, 2),
      );

      // Simulate successful publish
      await new Promise((resolve) => setTimeout(resolve, 50));

      console.log(`[NATS] Published successfully to ${subject}`);
    } catch (error) {
      console.error(`[NATS] Publish error:`, error);
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

      // In a real implementation, this would publish to NATS
      console.log(
        `[NATS] Publishing user message to ${subject}:`,
        JSON.stringify(data, null, 2),
      );

      // Simulate successful publish
      await new Promise((resolve) => setTimeout(resolve, 50));

      console.log(`[NATS] Published user message successfully to ${subject}`);
    } catch (error) {
      console.error(`[NATS] Publish user message error:`, error);
      throw error;
    }
  }

  /**
   * Close the connection
   */
  async close(): Promise<void> {
    try {
      // In a real implementation, this would close the NATS connection
      console.log(`[NATS] Closing connection`);

      // Simulate closing delay
      await new Promise((resolve) => setTimeout(resolve, 50));

      this.connected = false;
      console.log(`[NATS] Connection closed successfully`);
    } catch (error) {
      console.error(`[NATS] Close error:`, error);
      throw error;
    }
  }
}
