import { ArtifactCapabilitiesController } from "./artifact-capabilities.controller";
import { ArtifactUrlService } from "./artifact-url.service";
import { ArtifactUrlController } from "./artifact-url.controller";
import { Module } from "@nestjs/common";
import { JobQueueModule } from "../../../job-queue/job-queue.module";
import { S3Service } from "../../files/services/s3.service";
import { ArtifactStorageService } from "./artifact-storage.service";
import { ArtifactService } from "./artifact.service";

@Module({
  imports: [JobQueueModule],
  controllers: [ArtifactUrlController, ArtifactCapabilitiesController],
  providers: [
    ArtifactUrlService,
    S3Service,
    ArtifactStorageService,
    ArtifactService,
    { provide: "ArtifactService", useExisting: ArtifactService },
  ],
  exports: [ArtifactService, "ArtifactService"],
})
export class ArtifactModule {}
