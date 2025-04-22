import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import {
  ConnectionOptions,
  ErrorFunction,
  MessagingClient,
  SubscribeFunction,
} from "sn-messaging-ts-client";

@Injectable()
export class MessagingService {
  private client: MessagingClient;

  constructor(private configService: ConfigService) {}

  onModuleInit() {
    const url = this.configService.get<string>("NATS_URL");
    const user = this.configService.get<string>("NATS_USERNAME");
    const pass = this.configService.get<string>("NATS_PASSWORD");
    const organization = this.configService.get<string>("NATS_ORGANIZATION");
    const program = this.configService.get<string>("NATS_PROGRAM");
    const project = this.configService.get<string>("NATS_PROJECT");

    const options: ConnectionOptions = {
      user,
      pass,
      url,
      tls: true,
      organization,
      program,
      project,
    };

    this.client = new MessagingClient(options);
  }

  onApplicationBootstrap() {
    void this.client.publishService("start", {});
  }

  /**
   * Publishes a message for an action that this application has taken
   *
   * @action
   * @message
   */
  async publishService(action: string, message: unknown): Promise<unknown> {
    return this.client.publishService(action, message);
  }

  async publishUser(
    username: string,
    subject: string,
    message: unknown,
  ): Promise<unknown> {
    return this.client.publishUser(username, subject, message);
  }

  async subscribeService(
    project: string,
    messageCallback: SubscribeFunction,
    errorCallback: ErrorFunction,
  ): Promise<unknown> {
    return this.client.subscribeService(
      project,
      messageCallback,
      undefined,
      errorCallback,
    );
  }

  async subscribeUser(
    username: string,
    messageCallback: SubscribeFunction,
    errorCallback: ErrorFunction,
  ): Promise<unknown> {
    return this.client.subscribeUser(username, messageCallback, errorCallback);
  }
}
