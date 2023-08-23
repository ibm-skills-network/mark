import { absoluteUrl } from "../lib/utils";

const BASE_API_PATH = absoluteUrl("/api/v1");

export const BASE_API_ROUTES = {
  // default
  user: `${BASE_API_PATH}/user`,
  info: `${BASE_API_PATH}/info`,
  assets: `${BASE_API_PATH}/assets`,
  // assignments
  assignments: `${BASE_API_PATH}/assignments`,
  // admin
  admin: `${BASE_API_PATH}/admin`,
};
