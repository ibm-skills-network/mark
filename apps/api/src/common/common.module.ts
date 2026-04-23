import { Module, Global } from "@nestjs/common";
import { APP_FILTER, APP_INTERCEPTOR, Reflector } from "@nestjs/core";
import { AllExceptionsFilter } from "./filters/all-exceptions.filter";
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
    {
      provide: APP_FILTER,
      useClass: AllExceptionsFilter,
    },
  ],
  exports: [DataTransformInterceptor],
})
export class CommonModule {}
