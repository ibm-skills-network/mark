import { Module, Global } from "@nestjs/common";
import { APP_INTERCEPTOR, Reflector } from "@nestjs/core";
import { DataTransformInterceptor } from "./interceptors/data-transform.interceptor";

/**
 * Global module for common functionality including data transformation
 */
@Global()
@Module({
  providers: [
    Reflector,
    DataTransformInterceptor,
    {
      provide: APP_INTERCEPTOR,
      useClass: DataTransformInterceptor,
    },
  ],
  exports: [DataTransformInterceptor],
})
export class CommonModule {}
