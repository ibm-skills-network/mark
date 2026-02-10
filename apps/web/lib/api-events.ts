export const API_SERVER_ERROR_EVENT = "api:server-error";

export type ApiServerErrorDetail = {
  status: number;
  statusText?: string;
  message?: string;
  url?: string;
  method?: string;
};
