import {
  BadRequestException,
  Inject,
  Injectable,
  InternalServerErrorException,
} from "@nestjs/common";
import { AxiosRequestConfig } from "@nestjs/terminus/dist/health-indicator/http/axios.interfaces";
import axios, { AxiosError, Method } from "axios";
import { WINSTON_MODULE_PROVIDER } from "nest-winston";
import { Logger } from "winston";
import { MessagingService } from "../messaging/messaging.service";
import { DownstreamService } from "./api.controller";

@Injectable()
export class ApiService {
  private logger;
  constructor(
    private readonly messagingService: MessagingService,
    @Inject(WINSTON_MODULE_PROVIDER) parentLogger: Logger
  ) {
    this.logger = parentLogger.child({ context: ApiService.name });
  }
  rootV1(): Record<string, string | number> {
    this.logger.info("showing api version information");
    void this.messagingService.publishService("api", {});

    return {
      version: 1,
    };
  }

  async forwardRequestToDownstreamService(
    forwardingService: DownstreamService,
    request: Request & { originalUrl?: string }
  ): Promise<unknown> {
    try {
      if (!request.originalUrl) {
        throw new BadRequestException();
      }

      let forwardingEndpoint;

      switch (forwardingService) {
        case DownstreamService.MARK_API: {
          forwardingEndpoint = `${process.env.MARK_API_ENDPOINT ?? ""}${
            request.originalUrl
          }`;
          break;
        }
        case DownstreamService.LTI_CREDENTIAL_MANAGER: {
          const servicePath = request.originalUrl.split("/").slice(3).join("/");
          forwardingEndpoint = `${
            process.env.LTI_CREDENTIAL_MANAGER_ENDPOINT ?? ""
          }/${servicePath}`;
          break;
        }
        default: {
          throw new BadRequestException();
        }
      }

      this.logger.info(`Making request to ${forwardingEndpoint}`);

      const config: AxiosRequestConfig = {
        method: request.method.toLowerCase() as Method,
        url: forwardingEndpoint,
        data: request.body,
        headers: { ...request.headers },
      };

      const response = await axios.request(config);
      // eslint-disable-next-line @typescript-eslint/no-unsafe-return
      return response.data;
    } catch (error) {
      const axiosError = error as AxiosError;
      if (
        axiosError.isAxiosError &&
        axiosError.response &&
        axiosError.response.data
      ) {
        throw new InternalServerErrorException(axiosError.response.data);
      }
      throw new InternalServerErrorException("Error forwarding request");
    }
  }
}
