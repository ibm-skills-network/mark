import { createApi, fetchBaseQuery } from "@reduxjs/toolkit/query/react";
import {
  Assignment,
  AssignmentAttempt,
  FlaggedSubmission,
  RegradingRequest,
} from "@/config/types";
import { getBaseApiPath } from "@/config/constants";

// Define the base URL for your API
const baseUrl = getBaseApiPath("v1");

// Define a type for assignment creation/updating
export interface AssignmentRequest {
  name: string;
  groupId: string;
  type: string;
  introduction?: string;
  instructions?: string;
  gradingCriteriaOverview?: string;
  timeEstimateMinutes?: number;
  published?: string;
  numAttempts?: number;
  allotedTimeMinutes?: number;
  passingGrade?: number;
  displayOrder?: "DEFINED" | "RANDOM";
  questionDisplay?: "ONE_PER_PAGE" | "ALL_PER_PAGE";
}

// Define a type for analytics data
export interface AssignmentAnalytics {
  averageScore: number;
  medianScore: number;
  completionRate: number;
  totalAttempts: number;
  averageCompletionTime: number;
  scoreDistribution: { range: string; count: number }[];
  questionBreakdown: {
    questionId: number;
    averageScore: number;
    incorrectRate: number;
  }[];
}

export const adminApiSlice = createApi({
  reducerPath: "adminApi",
  baseQuery: fetchBaseQuery({
    baseUrl,
    prepareHeaders: (headers) => {
      return headers;
    },
  }),
  tagTypes: [
    "Assignment",
    "Assignments",
    "FlaggedSubmission",
    "RegradingRequest",
    "AssignmentAnalytics",
  ],
  endpoints: (builder) => ({
    // Assignments
    getAssignments: builder.query<Assignment[], void>({
      query: () => "/admin/assignments",
      providesTags: ["Assignments"],
    }),

    getAssignment: builder.query<Assignment, number>({
      query: (id) => `/admin/assignments/${id}`,
      providesTags: (result, error, id) => [{ type: "Assignment", id }],
    }),

    createAssignment: builder.mutation<Assignment, AssignmentRequest>({
      query: (assignment) => ({
        url: "/admin/assignments",
        method: "POST",
        body: assignment,
      }),
      invalidatesTags: ["Assignments"],
    }),

    updateAssignment: builder.mutation<
      Assignment,
      { id: number; data: Partial<AssignmentRequest> }
    >({
      query: ({ id, data }) => ({
        url: `/admin/assignments/${id}`,
        method: "PATCH",
        body: data,
      }),
      invalidatesTags: (result, error, { id }) => [
        { type: "Assignment", id },
        "Assignments",
      ],
    }),

    deleteAssignment: builder.mutation<void, number>({
      query: (id) => ({
        url: `/admin/assignments/${id}`,
        method: "DELETE",
      }),
      invalidatesTags: ["Assignments"],
    }),

    cloneAssignment: builder.mutation<
      Assignment,
      { id: number; groupId: string }
    >({
      query: ({ id, groupId }) => ({
        url: `/admin/assignments/clone/${id}`,
        method: "POST",
        body: { groupId },
      }),
      invalidatesTags: ["Assignments"],
    }),

    addAssignmentToGroup: builder.mutation<
      { success: boolean },
      { assignmentId: number; groupId: string }
    >({
      query: ({ assignmentId, groupId }) => ({
        url: `/admin/assignments/${assignmentId}/groups/${groupId}`,
        method: "POST",
      }),
      invalidatesTags: (result, error, { assignmentId }) => [
        { type: "Assignment", id: assignmentId },
      ],
    }),

    // Assignment Analytics
    getAssignmentAnalytics: builder.query<AssignmentAnalytics, number>({
      query: (id) => `/admin/assignments/${id}/analytics`,
      providesTags: (result, error, id) => [
        { type: "AssignmentAnalytics", id },
      ],
    }),

    // Flagged Submissions
    getFlaggedSubmissions: builder.query<FlaggedSubmission[], void>({
      query: () => "/admin/flagged-submissions",
      providesTags: ["FlaggedSubmission"],
    }),

    dismissFlaggedSubmission: builder.mutation<void, number>({
      query: (id) => ({
        url: `/admin/flagged-submissions/${id}/dismiss`,
        method: "POST",
      }),
      invalidatesTags: ["FlaggedSubmission"],
    }),

    // Regrading Requests
    getRegradingRequests: builder.query<RegradingRequest[], void>({
      query: () => "/admin/regrading-requests",
      providesTags: ["RegradingRequest"],
    }),

    approveRegradingRequest: builder.mutation<
      void,
      { id: number; newGrade: number }
    >({
      query: ({ id, newGrade }) => ({
        url: `/admin/regrading-requests/${id}/approve`,
        method: "POST",
        body: { newGrade },
      }),
      invalidatesTags: ["RegradingRequest"],
    }),

    rejectRegradingRequest: builder.mutation<
      void,
      { id: number; reason: string }
    >({
      query: ({ id, reason }) => ({
        url: `/admin/regrading-requests/${id}/reject`,
        method: "POST",
        body: { reason },
      }),
      invalidatesTags: ["RegradingRequest"],
    }),
  }),
});

// Export the auto-generated hooks for each endpoint
export const {
  useGetAssignmentsQuery,
  useGetAssignmentQuery,
  useCreateAssignmentMutation,
  useUpdateAssignmentMutation,
  useDeleteAssignmentMutation,
  useCloneAssignmentMutation,
  useAddAssignmentToGroupMutation,
  useGetAssignmentAnalyticsQuery,
  useGetFlaggedSubmissionsQuery,
  useDismissFlaggedSubmissionMutation,
  useGetRegradingRequestsQuery,
  useApproveRegradingRequestMutation,
  useRejectRegradingRequestMutation,
} = adminApiSlice;
