import { WinstonModuleOptions } from "nest-winston";
import { format, transports } from "winston";

const productionWinstonOptions: WinstonModuleOptions = {
  level: "info",
  format: format.json(),
  transports: [new transports.Console()],
};

const developmentWinstonOptions: WinstonModuleOptions = {
  level: "debug",
  format: format.combine(format.colorize(), format.simple()),
  transports: [new transports.Console()],
};

export const winstonOptions: WinstonModuleOptions =
  process.env.NODE_ENV == "production"
    ? productionWinstonOptions
    : developmentWinstonOptions;
