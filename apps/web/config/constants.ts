import { absoluteUrl } from "../lib/utils";
import type { Criteria } from "./types";

const BASE_API_PATH = absoluteUrl("/api/v1");

export const BASE_API_ROUTES = {
  // default
  user: `${BASE_API_PATH}/user-session`,
  info: `${BASE_API_PATH}/info`,
  assets: `${BASE_API_PATH}/assets`,
  // assignments
  assignments: `${BASE_API_PATH}/assignments`,
  // admin
  admin: `${BASE_API_PATH}/admin`,
};

export const initialCriteria: Criteria[] = [
  {
    id: 1,
    points: 0,
    description: "",
  },
  {
    id: 2,
    points: 1,
    description: "",
  },
];
