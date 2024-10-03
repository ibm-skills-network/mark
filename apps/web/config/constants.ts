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
  rubric: `${BASE_API_PATH}/assignments`,
};

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
    title: "5. What order should questions appear in?",
    required: true,
  },
  questionDisplay: {
    title: "6. how should questions be displayed?",
    required: false,
  },
} as const;
