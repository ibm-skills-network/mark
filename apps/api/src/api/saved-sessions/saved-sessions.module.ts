import { Module } from "@nestjs/common";
import { ScheduleModule } from "@nestjs/schedule";
import { SavedSessionsController } from "./saved-sessions.controller";
import { SavedSessionsService } from "./saved-sessions.service";

@Module({
  imports: [ScheduleModule.forRoot()],
  controllers: [SavedSessionsController],
  providers: [SavedSessionsService],
})
export class SavedSessionsModule {}
