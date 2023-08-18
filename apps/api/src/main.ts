import { ValidationPipe, VersioningType } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import cookieParser from "cookie-parser";
import helmet from "helmet";
import { WinstonModule } from "nest-winston";
import { AppModule } from "./app.module";
import { AuthModule } from "./auth/auth.module";
import { JwtGlobalAuthGuard } from "./auth/jwt/jwt.global.auth.guard";
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
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true })
  );
  app.useGlobalGuards(
    app.select(AuthModule).get(JwtGlobalAuthGuard),
    app.select(AuthModule).get(RolesGlobalGuard)
  );

  // TODO(user): customize the title, description, etc.
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

  await app.listen(3000);
}
void bootstrap();
