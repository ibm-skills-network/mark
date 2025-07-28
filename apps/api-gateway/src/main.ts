import { VersioningType } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import * as cookieParser from "cookie-parser";
import helmet from "helmet";
import { WinstonModule } from "nest-winston";
import { AppModule } from "./app.module";
import { winstonOptions } from "./logger/config";
import instana from "@instana/collector";

instana();

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    cors: false,
    logger: WinstonModule.createLogger(winstonOptions),
  });

  app.setGlobalPrefix("api", {
    exclude: ["health", "health/liveness", "health/readiness"],
  });

  app.enableVersioning({
    type: VersioningType.URI,
  });

  app.use(helmet());

  app.use(cookieParser());

  const config = new DocumentBuilder()
    .setTitle("API")
    .setDescription("API Description")
    .build();
  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup("api", app, document, {
    customSiteTitle: "API Docs",
    customCss: ".swagger-ui .topbar .topbar-wrapper { display: none; }",
  });

  app.enableShutdownHooks();

  await app.listen(process.env.API_GATEWAY_PORT ?? 3000);
}
void bootstrap();
