import { ValidationPipe, VersioningType } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import cookieParser from "cookie-parser";
import { json, urlencoded } from "express"; // Import these
import helmet from "helmet";
import { WinstonModule } from "nest-winston";
import { AppModule } from "./app.module";
import { AuthModule } from "./auth/auth.module";
import { RolesGlobalGuard } from "./auth/role/roles.global.guard";
import { winstonOptions } from "./logger/config";

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

  // Increase the JSON and URL-encoded body size limit to 10mb
  app.use(json({ limit: "10mb" }));
  app.use(urlencoded({ limit: "10mb", extended: true }));

  app.useGlobalPipes(new ValidationPipe({ whitelist: true }));
  app.useGlobalGuards(app.select(AuthModule).get(RolesGlobalGuard));

  // Swagger setup (if any)
  const config = new DocumentBuilder()
    .setTitle("API")
    .setDescription("API Description")
    .build();
  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup("api", app, document, {
    customSiteTitle: "API Docs",
    customCss: ".swagger-ui .topbar .topbar-wrapper { display: none; }",
  });

  // Starts listening for shutdown hooks
  app.enableShutdownHooks();

  await app.listen(process.env.API_PORT || 3000);
}
void bootstrap();
