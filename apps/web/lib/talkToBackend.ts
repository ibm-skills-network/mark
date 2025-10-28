/**
 * This file is used to talk to the backend.
 *
 * NOTE: This file now acts as a compatibility layer that re-exports
 * functions from the refactored API structure to maintain backward
 * compatibility with existing code.
 */
import * as apiConfig from "../config/constants";
import * as apiAuthor from "./author";
import * as apiGithub from "./github";
import * as apiLearner from "./learner";
import * as apiShared from "./shared";

export const BASE_API_ROUTES = apiConfig.getApiRoutes();

const API_VERSIONS = apiConfig.API_VERSIONS;

export const getUser = apiShared.getUser;
export const getAssignment = apiShared.getAssignment;
export const getAssignments = apiShared.getAssignments;
export const getSupportedLanguages = apiShared.getSupportedLanguages;
export const translateQuestion = apiShared.translateQuestion;
export const getFileAccess = apiShared.getFileAccess;

// Admin functions
export const getAdminFeedback = apiShared.getAdminFeedback;
export const getAdminReports = apiShared.getAdminReports;
export const getDashboardAssignments = apiShared.getDashboardAssignments;
export const getDashboardReports = apiShared.getDashboardReports;
export const getDashboardFeedback = apiShared.getDashboardFeedback;
export const getDashboardStats = apiShared.getDashboardStats;
export const getAssignmentAnalytics = apiShared.getAssignmentAnalytics;
export const getDetailedAssignmentInsights =
  apiShared.getDetailedAssignmentInsights;
export const executeQuickAction = apiShared.executeQuickAction;
export const getCurrentAdminUser = apiShared.getCurrentAdminUser;
export const isCurrentUserSuperAdmin = apiShared.isCurrentUserSuperAdmin;
export const upscalePricing = apiShared.upscalePricing;
export const getCurrentPriceUpscaling = apiShared.getCurrentPriceUpscaling;
export const removePriceUpscaling = apiShared.removePriceUpscaling;

// Admin types
export type {
  FeedbackData,
  ReportData,
  AdminPaginationInfo,
  FeedbackResponse,
  ReportsResponse,
  FeedbackFilters,
  ReportsFilters,
  AssignmentAnalyticsData,
  AssignmentAnalyticsResponse,
} from "./shared";

export const replaceAssignment = apiAuthor.replaceAssignment;
export const updateAssignment = apiAuthor.updateAssignment;
export const createQuestion = apiAuthor.createQuestion;
export const subscribeToJobStatus = apiAuthor.subscribeToJobStatus;
export const publishAssignment = apiAuthor.publishAssignment;
export const replaceQuestion = apiAuthor.replaceQuestion;
export const generateQuestionVariant = apiAuthor.generateQuestionVariant;
export const generateRubric = apiAuthor.generateRubric;
export const expandMarkingRubric = apiAuthor.expandMarkingRubric;
export const deleteQuestion = apiAuthor.deleteQuestion;
export const getAttempts = apiAuthor.getAttempts;
export const uploadFiles = apiAuthor.uploadFiles;
export const getJobStatus = apiAuthor.getJobStatus;
export const submitReportAuthor = apiAuthor.submitReportAuthor;

export const createAttempt = apiLearner.createAttempt;
export const getAttempt = apiLearner.getAttempt;
export const getCompletedAttempt = apiLearner.getCompletedAttempt;
export const getSuccessPageData = apiLearner.getSuccessPageData;
export const submitQuestion = apiLearner.submitQuestion;
export const getLiveRecordingFeedback = apiLearner.getLiveRecordingFeedback;
export const submitAssignment = apiLearner.submitAssignment;
export const getFeedback = apiLearner.getFeedback;
export const submitFeedback = apiLearner.submitFeedback;
export const submitRegradingRequest = apiLearner.submitRegradingRequest;
export const submitReportLearner = apiLearner.submitReportLearner;

export const AuthorizeGithubBackend = apiGithub.authorizeGithubBackend;
export const getStoredGithubToken = apiGithub.getStoredGithubToken;
export const exchangeGithubCodeForToken = apiGithub.exchangeGithubCodeForToken;

export const setApiVersion = (
  version: (typeof API_VERSIONS)[keyof typeof API_VERSIONS],
) => {
  apiConfig.setApiVersion(version);
};

export const getApiVersion = apiConfig.getApiVersion;
