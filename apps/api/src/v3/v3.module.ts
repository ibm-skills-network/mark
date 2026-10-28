import { Global, Module, OnModuleInit } from "@nestjs/common";
import { PATH_METADATA } from "@nestjs/common/constants";
import {
  DiscoveryModule,
  DiscoveryService,
  MetadataScanner,
  Reflector,
} from "@nestjs/core";
import { V3_SCOPE_METADATA } from "../common/v3-scope";
import { V3RequestContexts } from "./core/http-context";
import { V3_RESPONSE_METADATA } from "./core/response-contract.interceptor";
import { INSTANA, loadInstana, V3Tracing } from "./core/tracing";
import { V3Logger } from "./core/v3-logger";

/**
 * Root of v3. Global so every v3 family module gets the logger, tracing and
 * request context without importing this module. Refuses to start when a v3 route has no response contract.
 */
@Global()
@Module({
  imports: [DiscoveryModule],
  providers: [
    V3Logger,
    V3Tracing,
    V3RequestContexts,
    { provide: INSTANA, useFactory: loadInstana },
  ],
  exports: [V3Logger, V3Tracing, V3RequestContexts, INSTANA],
})
export class V3Module implements OnModuleInit {
  constructor(
    private readonly discovery: DiscoveryService,
    private readonly scanner: MetadataScanner,
    private readonly reflector: Reflector,
  ) {}

  onModuleInit(): void {
    const missing: string[] = [];
    for (const { metatype } of this.discovery.getControllers()) {
      if (
        typeof metatype !== "function" ||
        this.reflector.get<unknown>(V3_SCOPE_METADATA, metatype) !== true
      ) {
        continue;
      }
      const prototype: unknown = metatype.prototype;
      if (typeof prototype !== "object" || prototype === null) continue;
      for (const name of this.scanner.getAllMethodNames(prototype)) {
        const handler: unknown = Reflect.get(prototype, name);
        if (
          typeof handler === "function" &&
          this.reflector.get<unknown>(PATH_METADATA, handler) !== undefined &&
          this.reflector.get<unknown>(V3_RESPONSE_METADATA, handler) ===
            undefined
        ) {
          missing.push(`${metatype.name}.${name}()`);
        }
      }
    }
    if (missing.length > 0) {
      throw new Error(
        `v3 route(s) ${missing.join(", ")} declare no response contract; ` +
          "add @V3Route({ response }) to each",
      );
    }
  }
}
