// stores/adminStore.ts
import { create } from "zustand";
import { devtools, persist } from "zustand/middleware";
import {
  Assignment,
  RegradingRequest,
  FlaggedSubmission,
  AssignmentAnalytics,
} from "@/config/types";

// Define interfaces for admin state
interface AdminState {
  assignments: Assignment[];
  regradingRequests: RegradingRequest[];
  flaggedSubmissions: FlaggedSubmission[];
  analytics: Record<number, AssignmentAnalytics>; // Map assignment ID to analytics
  isLoading: boolean;
  error: string | null;
}

// Define interfaces for admin actions
interface AdminActions {
  fetchAssignments: () => Promise<void>;
  fetchRegradingRequests: () => Promise<void>;
  fetchFlaggedSubmissions: () => Promise<void>;
  fetchAssignmentAnalytics: (assignmentId: number) => Promise<void>;
  createAssignment: (assignment: Partial<Assignment>) => Promise<void>;
  updateAssignment: (
    assignmentId: number,
    data: Partial<Assignment>,
  ) => Promise<void>;
  deleteAssignment: (assignmentId: number) => Promise<void>;
  approveRegradingRequest: (
    requestId: number,
    newGrade: number,
  ) => Promise<void>;
  rejectRegradingRequest: (requestId: number, reason: string) => Promise<void>;
  dismissFlaggedSubmission: (submissionId: number) => Promise<void>;
  shareAssignment: (assignmentId: number, isPublic: boolean) => Promise<string>;
}

// Create admin store with state and actions
export const useAdminStore = create<AdminState & AdminActions>()(
  devtools(
    persist(
      (set, get) => ({
        // Initial state
        assignments: [],
        regradingRequests: [],
        flaggedSubmissions: [],
        analytics: {},
        isLoading: false,
        error: null,

        // Actions for assignments
        fetchAssignments: async () => {
          set({ isLoading: true, error: null });
          try {
            // TODO: Replace with actual API call
            // Simulating API response for now
            await new Promise((resolve) => setTimeout(resolve, 800));
            const mockAssignments: Assignment[] = [
              {
                id: 1,
                name: "Introduction to Data Structures",
                introduction:
                  "Learn the basics of data structures and algorithms",
                instructions:
                  "Complete all questions to test your understanding of data structures.",
                gradingCriteriaOverview:
                  "You will be evaluated based on your understanding of key concepts.",
                timeEstimateMinutes: 30,
                published: true,
                updatedAt: new Date(
                  Date.now() - 2 * 24 * 60 * 60 * 1000,
                ).toISOString(),
                questions: [],
              },
              {
                id: 2,
                name: "Python Programming Fundamentals",
                introduction:
                  "A comprehensive introduction to Python programming language",
                instructions:
                  "Answer all questions and submit your code solutions.",
                gradingCriteriaOverview:
                  "Code quality and correctness will be evaluated.",
                timeEstimateMinutes: 45,
                published: true,
                updatedAt: new Date(
                  Date.now() - 5 * 24 * 60 * 60 * 1000,
                ).toISOString(),
                questions: [],
              },
              {
                id: 3,
                name: "Machine Learning Basics",
                introduction:
                  "Introduction to fundamental concepts in machine learning",
                instructions:
                  "Complete the theoretical questions and implement the algorithms.",
                gradingCriteriaOverview:
                  "Understanding of concepts and implementation quality will be evaluated.",
                timeEstimateMinutes: 60,
                published: false,
                updatedAt: new Date(
                  Date.now() - 1 * 24 * 60 * 60 * 1000,
                ).toISOString(),
                questions: [],
              },
              {
                id: 4,
                name: "Web Development with React",
                introduction: "Learn modern web development using React",
                instructions:
                  "Build a small React application following the requirements.",
                gradingCriteriaOverview:
                  "Code quality, adherence to best practices, and functionality will be evaluated.",
                timeEstimateMinutes: 90,
                published: true,
                updatedAt: new Date(
                  Date.now() - 10 * 24 * 60 * 60 * 1000,
                ).toISOString(),
                questions: [],
              },
              {
                id: 5,
                name: "Database Design Principles",
                introduction: "Understanding database design and normalization",
                instructions:
                  "Design a database schema and answer conceptual questions.",
                gradingCriteriaOverview:
                  "Schema design and understanding of normalization will be evaluated.",
                timeEstimateMinutes: 40,
                published: false,
                updatedAt: new Date(
                  Date.now() - 3 * 24 * 60 * 60 * 1000,
                ).toISOString(),
                questions: [],
              },
            ];
            set({ assignments: mockAssignments, isLoading: false });
          } catch (error) {
            console.error("Failed to fetch assignments:", error);
            set({
              error:
                error instanceof Error
                  ? error.message
                  : "Failed to fetch assignments",
              isLoading: false,
            });
          }
        },

        createAssignment: async (assignment: Partial<Assignment>) => {
          set({ isLoading: true, error: null });
          try {
            // TODO: Replace with actual API call
            // Simulating API response for now
            await new Promise((resolve) => setTimeout(resolve, 800));

            // Create a new assignment with a mock ID
            const newAssignment: Assignment = {
              id: Math.floor(Math.random() * 1000) + 100, // Random ID for mock
              name: assignment.name || "Untitled Assignment",
              introduction: assignment.introduction || "",
              instructions: assignment.instructions || "",
              gradingCriteriaOverview: assignment.gradingCriteriaOverview || "",
              timeEstimateMinutes: assignment.timeEstimateMinutes,
              published: assignment.published || false,
              updatedAt: new Date().toISOString(),
              questions: [],
            };

            set((state) => ({
              assignments: [...state.assignments, newAssignment],
              isLoading: false,
            }));
          } catch (error) {
            console.error("Failed to create assignment:", error);
            set({
              error:
                error instanceof Error
                  ? error.message
                  : "Failed to create assignment",
              isLoading: false,
            });
          }
        },

        updateAssignment: async (
          assignmentId: number,
          data: Partial<Assignment>,
        ) => {
          set({ isLoading: true, error: null });
          try {
            // TODO: Replace with actual API call
            // Simulating API response for now
            await new Promise((resolve) => setTimeout(resolve, 600));

            set((state) => ({
              assignments: state.assignments.map((assignment) =>
                assignment.id === assignmentId
                  ? {
                      ...assignment,
                      ...data,
                      updatedAt: new Date().toISOString(),
                    }
                  : assignment,
              ),
              isLoading: false,
            }));
          } catch (error) {
            console.error(
              `Failed to update assignment ${assignmentId}:`,
              error,
            );
            set({
              error:
                error instanceof Error
                  ? error.message
                  : "Failed to update assignment",
              isLoading: false,
            });
          }
        },

        deleteAssignment: async (assignmentId: number) => {
          set({ isLoading: true, error: null });
          try {
            // TODO: Replace with actual API call
            // Simulating API response for now
            await new Promise((resolve) => setTimeout(resolve, 500));

            set((state) => ({
              assignments: state.assignments.filter(
                (assignment) => assignment.id !== assignmentId,
              ),
              isLoading: false,
            }));
          } catch (error) {
            console.error(
              `Failed to delete assignment ${assignmentId}:`,
              error,
            );
            set({
              error:
                error instanceof Error
                  ? error.message
                  : "Failed to delete assignment",
              isLoading: false,
            });
          }
        },

        shareAssignment: async (assignmentId: number, isPublic: boolean) => {
          // This would generate or retrieve a shareable link
          // For now, just return a mock URL
          const baseUrl =
            typeof window !== "undefined" ? window.location.origin : "";
          const token = isPublic
            ? ""
            : `?token=${Math.random().toString(36).substring(2, 15)}`;
          return `${baseUrl}/learner/${assignmentId}${token}`;
        },

        // Actions for regrading requests
        fetchRegradingRequests: async () => {
          set({ isLoading: true, error: null });
          try {
            // TODO: Replace with actual API call
            // Simulating API response for now
            await new Promise((resolve) => setTimeout(resolve, 800));

            const mockRequests: RegradingRequest[] = [
              {
                id: 1,
                assignmentId: 1,
                userId: "user1",
                attemptId: 101,
                regradingReason:
                  "I believe question 3 was graded incorrectly. My answer matches the expected output.",
                regradingStatus: "PENDING",
                createdAt: new Date(
                  Date.now() - 2 * 24 * 60 * 60 * 1000,
                ).toISOString(),
                updatedAt: new Date(
                  Date.now() - 2 * 24 * 60 * 60 * 1000,
                ).toISOString(),
              },
              {
                id: 2,
                assignmentId: 2,
                userId: "user2",
                attemptId: 102,
                regradingReason:
                  "The code challenge should accept multiple valid solutions. My solution produces correct results.",
                regradingStatus: "PENDING",
                createdAt: new Date(
                  Date.now() - 1 * 24 * 60 * 60 * 1000,
                ).toISOString(),
                updatedAt: new Date(
                  Date.now() - 1 * 24 * 60 * 60 * 1000,
                ).toISOString(),
              },
              {
                id: 3,
                assignmentId: 1,
                userId: "user3",
                attemptId: 103,
                regradingReason:
                  "My explanation for question 5 addressed all the required points but was marked as incomplete.",
                regradingStatus: "APPROVED",
                createdAt: new Date(
                  Date.now() - 5 * 24 * 60 * 60 * 1000,
                ).toISOString(),
                updatedAt: new Date(
                  Date.now() - 3 * 24 * 60 * 60 * 1000,
                ).toISOString(),
              },
            ];

            set({ regradingRequests: mockRequests, isLoading: false });
          } catch (error) {
            console.error("Failed to fetch regrading requests:", error);
            set({
              error:
                error instanceof Error
                  ? error.message
                  : "Failed to fetch regrading requests",
              isLoading: false,
            });
          }
        },

        approveRegradingRequest: async (
          requestId: number,
          newGrade: number,
        ) => {
          set({ isLoading: true, error: null });
          try {
            // TODO: Replace with actual API call
            await new Promise((resolve) => setTimeout(resolve, 600));

            set((state) => ({
              regradingRequests: state.regradingRequests.map((request) =>
                request.id === requestId
                  ? {
                      ...request,
                      regradingStatus: "APPROVED",
                      updatedAt: new Date().toISOString(),
                    }
                  : request,
              ),
              isLoading: false,
            }));
          } catch (error) {
            console.error(
              `Failed to approve regrading request ${requestId}:`,
              error,
            );
            set({
              error:
                error instanceof Error
                  ? error.message
                  : "Failed to approve regrading request",
              isLoading: false,
            });
          }
        },

        rejectRegradingRequest: async (requestId: number, reason: string) => {
          set({ isLoading: true, error: null });
          try {
            // TODO: Replace with actual API call
            await new Promise((resolve) => setTimeout(resolve, 600));

            set((state) => ({
              regradingRequests: state.regradingRequests.map((request) =>
                request.id === requestId
                  ? {
                      ...request,
                      regradingStatus: "REJECTED",
                      updatedAt: new Date().toISOString(),
                    }
                  : request,
              ),
              isLoading: false,
            }));
          } catch (error) {
            console.error(
              `Failed to reject regrading request ${requestId}:`,
              error,
            );
            set({
              error:
                error instanceof Error
                  ? error.message
                  : "Failed to reject regrading request",
              isLoading: false,
            });
          }
        },

        // Actions for flagged submissions
        fetchFlaggedSubmissions: async () => {
          set({ isLoading: true, error: null });
          try {
            // TODO: Replace with actual API call
            await new Promise((resolve) => setTimeout(resolve, 800));

            const mockFlaggedSubmissions: FlaggedSubmission[] = [
              {
                id: 1,
                assignmentId: 1,
                attemptId: 201,
                userId: "user5",
                reason:
                  "Potential plagiarism detected with 85% similarity to another submission",
                status: "PENDING",
                createdAt: new Date(
                  Date.now() - 1 * 24 * 60 * 60 * 1000,
                ).toISOString(),
                questionId: 101,
              },
              {
                id: 2,
                assignmentId: 2,
                attemptId: 202,
                userId: "user6",
                reason:
                  "Abnormally fast completion time (2 minutes) with perfect score",
                status: "PENDING",
                createdAt: new Date(
                  Date.now() - 2 * 24 * 60 * 60 * 1000,
                ).toISOString(),
                questionId: 102,
              },
              {
                id: 3,
                assignmentId: 1,
                attemptId: 203,
                userId: "user7",
                reason:
                  "AI-generated content detected in answer with 92% confidence",
                status: "PENDING",
                createdAt: new Date(
                  Date.now() - 3 * 24 * 60 * 60 * 1000,
                ).toISOString(),
                questionId: 103,
              },
            ];

            set({
              flaggedSubmissions: mockFlaggedSubmissions,
              isLoading: false,
            });
          } catch (error) {
            console.error("Failed to fetch flagged submissions:", error);
            set({
              error:
                error instanceof Error
                  ? error.message
                  : "Failed to fetch flagged submissions",
              isLoading: false,
            });
          }
        },

        dismissFlaggedSubmission: async (submissionId: number) => {
          set({ isLoading: true, error: null });
          try {
            // TODO: Replace with actual API call
            await new Promise((resolve) => setTimeout(resolve, 600));

            set((state) => ({
              flaggedSubmissions: state.flaggedSubmissions.filter(
                (submission) => submission.id !== submissionId,
              ),
              isLoading: false,
            }));
          } catch (error) {
            console.error(
              `Failed to dismiss flagged submission ${submissionId}:`,
              error,
            );
            set({
              error:
                error instanceof Error
                  ? error.message
                  : "Failed to dismiss flagged submission",
              isLoading: false,
            });
          }
        },

        // Action for analytics
        fetchAssignmentAnalytics: async (assignmentId: number) => {
          set({ isLoading: true, error: null });
          try {
            // TODO: Replace with actual API call
            await new Promise((resolve) => setTimeout(resolve, 1000));

            // Generate mock analytics data
            const mockAnalytics: AssignmentAnalytics = {
              assignmentId,
              totalAttempts: Math.floor(Math.random() * 150) + 50,
              averageScore: Math.random() * 30 + 60, // Average between 60-90%
              medianScore: Math.random() * 30 + 60,
              completionRate: Math.random() * 40 + 60, // Between 60-100%
              averageCompletionTime: Math.floor(Math.random() * 40) + 20, // 20-60 minutes
              questionBreakdown: [
                {
                  questionId: 1001,
                  averageScore: Math.random() * 100,
                  incorrectRate: Math.random() * 50,
                },
                {
                  questionId: 1002,
                  averageScore: Math.random() * 100,
                  incorrectRate: Math.random() * 50,
                },
                {
                  questionId: 1003,
                  averageScore: Math.random() * 100,
                  incorrectRate: Math.random() * 50,
                },
              ],
              scoreDistribution: [
                { range: "0-10%", count: Math.floor(Math.random() * 5) },
                { range: "11-20%", count: Math.floor(Math.random() * 5) },
                { range: "21-30%", count: Math.floor(Math.random() * 5) },
                { range: "31-40%", count: Math.floor(Math.random() * 10) },
                { range: "41-50%", count: Math.floor(Math.random() * 10) },
                { range: "51-60%", count: Math.floor(Math.random() * 15) },
                { range: "61-70%", count: Math.floor(Math.random() * 20) },
                { range: "71-80%", count: Math.floor(Math.random() * 30) },
                { range: "81-90%", count: Math.floor(Math.random() * 25) },
                { range: "91-100%", count: Math.floor(Math.random() * 15) },
              ],
            };

            set((state) => ({
              analytics: {
                ...state.analytics,
                [assignmentId]: mockAnalytics,
              },
              isLoading: false,
            }));
          } catch (error) {
            console.error(
              `Failed to fetch analytics for assignment ${assignmentId}:`,
              error,
            );
            set({
              error:
                error instanceof Error
                  ? error.message
                  : "Failed to fetch assignment analytics",
              isLoading: false,
            });
          }
        },
      }),
      {
        name: "admin-store",
        // Only persist assignments, not loading state or errors
        partialize: (state) => ({
          assignments: state.assignments,
          regradingRequests: state.regradingRequests,
          flaggedSubmissions: state.flaggedSubmissions,
          analytics: state.analytics,
        }),
      },
    ),
  ),
);

// Extension of types for typesafe store
declare module "@/config/types" {
  interface FlaggedSubmission {
    id: number;
    assignmentId: number;
    attemptId: number;
    userId: string;
    questionId: number;
    reason: string;
    status: "PENDING" | "RESOLVED" | "DISMISSED";
    createdAt: string;
  }

  interface AssignmentAnalytics {
    assignmentId: number;
    totalAttempts: number;
    averageScore: number;
    medianScore: number;
    completionRate: number;
    averageCompletionTime: number;
    questionBreakdown: {
      questionId: number;
      averageScore: number;
      incorrectRate: number;
    }[];
    scoreDistribution: {
      range: string;
      count: number;
    }[];
  }
}
