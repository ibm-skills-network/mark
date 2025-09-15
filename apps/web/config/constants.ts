import { absoluteUrl } from "../lib/utils";
import { versions } from "process";

export const API_VERSIONS = {
  V1: "v1",
  V2: "v2",
} as const;

export type ApiVersion = (typeof API_VERSIONS)[keyof typeof API_VERSIONS];

let currentApiVersion: ApiVersion = API_VERSIONS.V2;

/**
 * Sets the API version to use for all requests
 * @param version The API version to use
 */
export function setApiVersion(version: ApiVersion): void {
  currentApiVersion = version;
}

/**
 * Gets the current API version
 * @returns The current API version
 */
export function getApiVersion(): ApiVersion {
  return currentApiVersion;
}

/**
 * Creates the base API path for the current version
 * @returns The base API path
 */
export function getBaseApiPath(overrideVersion?: ApiVersion): string {
  if (overrideVersion) {
    return absoluteUrl(`/api/${overrideVersion}`);
  }
  return absoluteUrl(`/api/${currentApiVersion}`);
}

/**
 * Creates the API routes for the current version
 * @returns The API routes object
 */
export function getApiRoutes() {
  const BASE_API_PATH = getBaseApiPath();

  return {
    user: `${BASE_API_PATH}/user-session`,
    info: `${BASE_API_PATH}/info`,
    assets: `${BASE_API_PATH}/assets`,

    assignments: `${BASE_API_PATH}/assignments`,

    versions: `${getBaseApiPath("v2")}/assignments`,

    admin: `${BASE_API_PATH}/admin`,
    rubric: `${BASE_API_PATH}/assignments`,

    reports: `${BASE_API_PATH}/reports`,

    github: `${BASE_API_PATH}/github`,
    chats: `${getBaseApiPath("v1")}/chats`,
  };
}

export const stepTwoSections = {
  type: {
    title: "1. What type of assignment is this?",
    required: true,
  },
  time: {
    title: "2. How much time will learners have to complete this assignment?",
    required: false,
  },
  completion: {
    title: "3. How will learners complete the assignment?",
    required: true,
  },
  feedback: {
    title: "4. How much feedback should I give students?",
    description: "Choose what feedback Mark gives to students",
    required: true,
  },
  order: {
    title: "6. How should questions be presented to the learner?",
    required: true,
  },
  questionDisplay: {
    title: "5. How should the questions be displayed?",
    required: false,
  },
} as const;

export const formatPricePerMillionTokens = (pricePerToken: number) => {
  const pricePerMillion = pricePerToken * 1000000;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(pricePerMillion);
};
