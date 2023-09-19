import { Global, Module } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { MessagingService } from "./messaging.service";

@Global()
@Module({
  providers: [MessagingService, ConfigService],
  exports: [MessagingService],
})
export class MessagingModule {}
