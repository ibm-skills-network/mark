import { Routes } from "@nestjs/core";
import { ApiModule } from "./api/api.module";
import { HealthModule } from "./health/health.module";

export const routes: Routes = [
  {
    path: "/",
    module: ApiModule,
  },
  {
    path: "/health/",
    module: HealthModule,
  },
];
