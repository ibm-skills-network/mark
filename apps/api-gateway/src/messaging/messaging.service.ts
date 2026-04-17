import { Inject, Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { WINSTON_MODULE_PROVIDER } from "nest-winston";
import {
  ConnectionOptions,
  ErrorFunction,
  MessagingClient,
  SubscribeFunction,
} from "sn-messaging-ts-client";
import { Logger } from "winston";

function formatStreamError(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return JSON.stringify(error);
}

@Injectable()
export class MessagingService {
  private client: MessagingClient;
  private readonly logger: Logger;

  constructor(
    private configService: ConfigService,
    @Inject(WINSTON_MODULE_PROVIDER) parentLogger: Logger,
  ) {
    this.logger = parentLogger.child({ context: MessagingService.name });
  }

  onModuleInit() {
    const url = this.configService.get<string>("NATS_URL");
    const user = this.configService.get<string>("NATS_USERNAME");
    const pass = this.configService.get<string>("NATS_PASSWORD");
    const organization = this.configService.get<string>("NATS_ORGANIZATION");
    const program = this.configService.get<string>("NATS_PROGRAM");
    const project = this.configService.get<string>("NATS_PROJECT");

    if (url) {
      this.logger.info("messaging client initializing", {
        nats_url: url,
        nats_user_set: !!user,
        nats_pass_set: !!pass,
        nats_organization: organization,
        nats_program: program,
        nats_project: project,
        tls: true,
      });
    } else {
      this.logger.warn(
        "NATS_URL is not set; messaging client will not connect",
        {
          nats_url_set: false,
          nats_user_set: !!user,
          nats_organization: organization,
          nats_program: program,
          nats_project: project,
        },
      );
    }

    const options: ConnectionOptions = {
      user,
      pass, // pragma: allowlist secret
      url,
      tls: true,
      organization,
      program,
      project,
    };

    try {
      this.client = new MessagingClient(options);
      this.logger.info("messaging client constructed");
    } catch (error) {
      this.logger.error("messaging client constructor failed", {
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      });
      throw error;
    }
  }

  onApplicationBootstrap() {
    this.logger.info("publishing bootstrap 'start' event");
    void this.client.publishService("start", {}).then(
      () => this.logger.info("bootstrap 'start' event published"),
      (error: unknown) =>
        this.logger.error("bootstrap 'start' event publish failed", {
          error: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? error.stack : undefined,
        }),
    );
  }

  /**
   * Publishes a message for an action that this application has taken
   */
  async publishService(action: string, message: unknown): Promise<unknown> {
    this.logger.debug(`publishService action=${action}`, {
      action,
      message_keys:
        message && typeof message === "object"
          ? Object.keys(message as Record<string, unknown>)
          : undefined,
    });
    try {
      const result = await this.client.publishService(action, message);
      return result;
    } catch (error) {
      this.logger.error(`publishService failed action=${action}`, {
        action,
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      });
      throw error;
    }
  }

  async publishUser(
    username: string,
    subject: string,
    message: unknown,
  ): Promise<unknown> {
    this.logger.debug(`publishUser username=${username} subject=${subject}`, {
      username,
      subject,
    });
    try {
      const result = await this.client.publishUser(username, subject, message);
      return result;
    } catch (error) {
      this.logger.error(
        `publishUser failed username=${username} subject=${subject}`,
        {
          username,
          subject,
          error: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? error.stack : undefined,
        },
      );
      throw error;
    }
  }

  async subscribeService(
    project: string,
    messageCallback: SubscribeFunction,
    errorCallback: ErrorFunction,
  ): Promise<unknown> {
    this.logger.info(`subscribeService project=${project}`);
    const wrappedError: ErrorFunction = (error) => {
      this.logger.error(`subscribeService stream error project=${project}`, {
        project,
        error: formatStreamError(error),
      });
      errorCallback(error);
    };
    try {
      const result = await this.client.subscribeService(
        project,
        messageCallback,
        undefined,
        wrappedError,
      );
      return result;
    } catch (error) {
      this.logger.error(`subscribeService setup failed project=${project}`, {
        project,
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      });
      throw error;
    }
  }

  async subscribeUser(
    username: string,
    messageCallback: SubscribeFunction,
    errorCallback: ErrorFunction,
  ): Promise<unknown> {
    this.logger.info(`subscribeUser username=${username}`);
    const wrappedError: ErrorFunction = (error) => {
      this.logger.error(`subscribeUser stream error username=${username}`, {
        username,
        error: formatStreamError(error),
      });
      errorCallback(error);
    };
    try {
      const result = await this.client.subscribeUser(
        username,
        messageCallback,
        wrappedError,
      );
      return result;
    } catch (error) {
      this.logger.error(`subscribeUser setup failed username=${username}`, {
        username,
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      });
      throw error;
    }
  }
}
