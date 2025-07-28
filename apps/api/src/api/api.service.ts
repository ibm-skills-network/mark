import { Inject, Injectable } from "@nestjs/common";
import { WINSTON_MODULE_PROVIDER } from "nest-winston";
import { Logger } from "winston";
import { MessagingService } from "../messaging/messaging.service";

@Injectable()
export class ApiService {
  private logger: Logger;
  constructor(
    private readonly messagingService: MessagingService,
    @Inject(WINSTON_MODULE_PROVIDER) parentLogger: Logger,
  ) {
    this.logger = parentLogger.child({ context: ApiService.name });
  }
  rootV1(): Record<string, string | number> {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call
    this.logger.info("showing api version information");
    void this.messagingService.publishService("api", {});

    return {
      version: 1,
    };
  }

  rootV2(): string {
    return "Not Yet Implemented";
  }
}
