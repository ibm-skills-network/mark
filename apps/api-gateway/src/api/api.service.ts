import {
  BadRequestException,
  HttpException,
  Inject,
  Injectable,
  InternalServerErrorException,
} from "@nestjs/common";
import { AxiosRequestConfig } from "@nestjs/terminus/dist/health-indicator/http/axios.interfaces";
import axios, { AxiosError, Method } from "axios";
import { WINSTON_MODULE_PROVIDER } from "nest-winston";
import { Logger } from "winston";
import { UserSessionRequest } from "../auth/interfaces/user.session.interface";
import { MessagingService } from "../messaging/messaging.service";
import { DownstreamService } from "./api.controller";

@Injectable()
export class ApiService {
  private logger;
  constructor(
    private readonly messagingService: MessagingService,
    @Inject(WINSTON_MODULE_PROVIDER) parentLogger: Logger,
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
    request: UserSessionRequest & { originalUrl?: string },
  ): Promise<{ data: string; status: number }> {
    try {
      if (!request.originalUrl) {
        throw new BadRequestException();
      }

      let forwardingEndpoint;
      let forwardingServiceHeaders;

      switch (forwardingService) {
        case DownstreamService.MARK_API: {
          forwardingEndpoint = `${process.env.MARK_API_ENDPOINT ?? ""}${
            request.originalUrl
          }`;
          forwardingServiceHeaders = {
            "user-session": JSON.stringify(request.user),
          };
          break;
        }
        case DownstreamService.LTI_CREDENTIAL_MANAGER: {
          const servicePath = request.originalUrl.split("/").slice(3).join("/");
          forwardingEndpoint = `${
            process.env.LTI_CREDENTIAL_MANAGER_ENDPOINT ?? ""
          }/${servicePath}`;
          // Encode username and password for Basic Auth
          const username = process.env.LTI_CREDENTIAL_MANAGER_USERNAME ?? "";
          const password = process.env.LTI_CREDENTIAL_MANAGER_PASSWORD ?? ""; // pragma: allowlist secret
          const base64Credentials = Buffer.from(
            `${username}:${password}`,
          ).toString("base64");

          forwardingServiceHeaders = {
            Authorization: `Basic ${base64Credentials}`,
          };
          break;
        }
        default: {
          throw new BadRequestException();
        }
      }

      this.logger.info(`Making request to ${forwardingEndpoint}`);

      const originalHeaders = { ...request.headers };

      // Delete potentially problematic headers.
      delete originalHeaders["host"];
      delete originalHeaders["content-length"];

      const config: AxiosRequestConfig = {
        method: request.method.toLowerCase() as Method,
        url: forwardingEndpoint,
        // eslint-disable-next-line  @typescript-eslint/no-unsafe-assignment
        data: request.body,
        headers: {
          ...originalHeaders,
          ...forwardingServiceHeaders,
        },
      };

      this.logger.info("Forwarding request: ", config);

      const response = await axios.request(config);
      return {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        data: response.data,
        status: response.status,
      };
    } catch (error) {
      const axiosError = error as AxiosError;
      if (axiosError.isAxiosError && axiosError.response) {
        this.logger.error(axiosError.response.status);
        this.logger.error(axiosError.response.data);
        throw new HttpException(
          axiosError.response?.data ?? "",
          axiosError.response.status,
        );
      }
      this.logger.error(error);
      throw new InternalServerErrorException();
    }
  }
}
