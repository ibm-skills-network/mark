import { Global, Module } from "@nestjs/common";
import { DatabaseCircuitBreakerService } from "./circuit-breaker/database-circuit-breaker.service";
import { PrismaService } from "./prisma.service";

@Global()
@Module({
  providers: [PrismaService, DatabaseCircuitBreakerService],
  exports: [PrismaService, DatabaseCircuitBreakerService],
})
export class DatabaseModule {}
