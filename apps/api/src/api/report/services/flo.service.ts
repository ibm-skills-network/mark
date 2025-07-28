/* eslint-disable unicorn/no-null */
import { Injectable, Logger } from "@nestjs/common";
import { MessagingClient } from "sn-messaging-ts-client";
import { Program } from "../helpers/program";
import {
  NatsConnectionOptions,
  SkillsNetworkNatsServer,
} from "../types/report.types";

@Injectable()
export class FloService {
  private readonly logger = new Logger(FloService.name);
  private messagingClient: MessagingClient | null = null;
  private readonly natsConfig = {
    servers: [
      process.env.NATS_URL ||
        (process.env.NODE_ENV === "production"
          ? SkillsNetworkNatsServer.PRODUCTION
          : SkillsNetworkNatsServer.STAGING),
    ],
    organization: process.env.SN_ORGANIZATION || "sn",
    program: process.env.SN_PROGRAM || Program.PORTALS,
    project: process.env.SN_PROJECT || "mark",
    tls: {
      rejectUnauthorized: true,
    },
  };

  constructor() {
    this.initClient();
  }

  private initClient(): MessagingClient | null {
    if (this.messagingClient) {
      return this.messagingClient;
    }

    const natsUsername = process.env.NATS_USERNAME;
    const natsPassword = process.env.NATS_PASSWORD;

    if (!natsUsername || !natsPassword) {
      this.logger.warn(
        "NATS credentials not provided, Flo integration disabled",
      );
      return null;
    }

    try {
      const options: NatsConnectionOptions = {
        user: natsUsername,
        pass: natsPassword,
        organization: this.natsConfig.organization,
        program: this.natsConfig.program,
        project: this.natsConfig.project,
        servers: this.natsConfig.servers,
        tls: this.natsConfig.tls,
      };

      this.messagingClient = new MessagingClient(options);
      this.logger.log("NATS client initialized successfully");
      return this.messagingClient;
    } catch (error) {
      this.logger.error(
        "Failed to initialize NATS client",
        (error as Error).stack,
      );
      return null;
    }
  }

  /**
   * Send an error message to Flo
   */
  async sendError(
    title: string,
    description: string,
    options: {
      severity?: "info" | "warning" | "error" | "critical";
      tags?: string[];
      [key: string]: any;
    } = {},
  ): Promise<boolean> {
    const client = this.initClient();
    const userEmail = "test@test";
    if (!client) {
      this.logger.warn("NATS client not initialized, cannot send error to Flo");
      return false;
    }

    try {
      const messageData = {
        title,
        description,
        category: "Mark Issue",
        severity: options.severity || "info",
        tool_name: "Mark AI Assistant",
        type: "service",
        tags: options.tags || ["mark", "chat"],
        ...options,
      };

      await client.publishUser(userEmail, "support.create", messageData);

      this.logger.log(`Error report sent to Flo: ${title}`);
      return true;
    } catch (error) {
      this.logger.error(
        `Error sending to Flo: ${(error as Error).message}`,
        (error as Error).stack,
      );
      return false;
    }
  }

  /**
   * Send feedback to Flo
   */
  async sendFeedback(
    title: string,
    description: string,
    options: {
      rating?: string;
      portalName?: string;
      portalUrl?: string;
      userEmail?: string;
      [key: string]: any;
    } = {},
  ): Promise<boolean> {
    const client = this.initClient();
    if (!client) {
      this.logger.warn(
        "NATS client not initialized, cannot send feedback to Flo",
      );
      return false;
    }

    try {
      const messageData = {
        organization: this.natsConfig.organization,
        program: this.natsConfig.program,
        project: this.natsConfig.project,
        action: "feedback",
        date: new Date().toISOString(),
        subject: `${this.natsConfig.organization}.${this.natsConfig.program}.${this.natsConfig.project}.service.feedback`,
        type: "service",
        title,
        description,
        category: "feedback",
        portal_name: options.portalName || "Mark AI Assistant",
        portal_url: options.portalUrl,
        user_email: options.userEmail,
        rating: options.rating || "3",
        ...options,
      };

      await client.publishService("feedback", messageData);

      this.logger.log(`Feedback sent to Flo: ${title}`);
      return true;
    } catch (error) {
      this.logger.error(
        `Error sending feedback to Flo: ${(error as Error).message}`,
        (error as Error).stack,
      );
      return false;
    }
  }

  /**
   * Send support request to Flo
   */
  async sendSupportRequest(
    title: string,
    description: string,
    options: {
      portalName?: string;
      category?: string;
      userEmail?: string;
      chatroomId?: number;
      [key: string]: any;
    } = {},
  ): Promise<boolean> {
    const client = this.initClient();
    if (!client) {
      this.logger.warn(
        "NATS client not initialized, cannot send support request to Flo",
      );
      return false;
    }

    try {
      const messageData = {
        organization: this.natsConfig.organization,
        program: this.natsConfig.program,
        project: this.natsConfig.project,
        action: "support",
        date: new Date().toISOString(),
        subject: `${this.natsConfig.organization}.${this.natsConfig.program}.${this.natsConfig.project}.service.support`,
        type: "service",
        title,
        description,
        portal_name: options.portalName || "Mark AI Assistant",
        category: options.category || "Support Request",
        userEmail: options.userEmail,
        chatroomId: options.chatroomId,
        ...options,
      };

      await client.publishService("support", messageData);

      this.logger.log(`Support request sent to Flo: ${title}`);
      return true;
    } catch (error) {
      this.logger.error(
        `Error sending support request to Flo: ${(error as Error).message}`,
        (error as Error).stack,
      );
      return false;
    }
  }
}
