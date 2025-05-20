// components/admin/AssignmentAnalytics.tsx
"use client";

import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import {
  ChartBarSquareIcon,
  ClockIcon,
  UserGroupIcon,
  CheckCircleIcon,
  ArrowTrendingUpIcon,
  QuestionMarkCircleIcon,
} from "@heroicons/react/24/outline";
import animationData from "@/animations/LoadSN.json";

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  LineChart,
  Line,
} from "recharts";
import { 
  useGetAssignmentsQuery,
  useGetAssignmentAnalyticsQuery 
} from "@/lib/admin";
import LoadingSpinner from "../Loading";

export default function AssignmentAnalytics() {
  const [selectedAssignmentId, setSelectedAssignmentId] = useState<number | null>(null);

  // Fetch assignments list
  const { 
    data: assignments = [], 
    isLoading: isLoadingAssignments,
    error: assignmentsError
  } = useGetAssignmentsQuery();

  // Fetch analytics for selected assignment
  const { 
    data: assignmentAnalytics, 
    isLoading: isLoadingAnalytics,
    error: analyticsError
  } = useGetAssignmentAnalyticsQuery(selectedAssignmentId ?? 0, {
    skip: selectedAssignmentId === null, // Skip if no assignment selected
  });

  // Select first assignment by default when assignments are loaded
  useEffect(() => {
    if (assignments.length > 0 && !selectedAssignmentId) {
      setSelectedAssignmentId(assignments[0].id);
    }
  }, [assignments, selectedAssignmentId]);

  const handleAssignmentChange = (assignmentId: number) => {
    setSelectedAssignmentId(assignmentId);
  };

  // Get the selected assignment
  const selectedAssignment = assignments.find(
    (a) => a.id === selectedAssignmentId,
  );

  // Combined loading state
  const isLoading = isLoadingAssignments || isLoadingAnalytics;

  // Handle errors
  if (assignmentsError) {
    return (
      <div className="p-6 bg-red-50 text-red-600 rounded-md">
        Error loading assignments: {assignmentsError.toString()}
      </div>
    );
  }

  if (analyticsError && selectedAssignmentId) {
    return (
      <div className="p-6 bg-red-50 text-red-600 rounded-md">
        Error loading analytics: {analyticsError.toString()}
      </div>
    );
  }

  const COLORS = [
    "#8884d8",
    "#82ca9d",
    "#ffc658",
    "#ff8042",
    "#0088FE",
    "#00C49F",
    "#FFBB28",
    "#FF8042",
  ];

  return (
    <div className="space-y-6">
      {/* Assignment Selector */}
      <div className="bg-white p-4 rounded-lg shadow-sm border border-gray-100">
        <div className="flex items-center">
          <label
            htmlFor="assignment-select"
            className="text-sm font-medium text-gray-700 mr-3"
          >
            Select Assignment:
          </label>
          <select
            id="assignment-select"
            value={selectedAssignmentId || ""}
            onChange={(e) => handleAssignmentChange(parseInt(e.target.value))}
            className="flex-1 max-w-md pl-3 py-2 text-base border border-gray-300 rounded-md focus:outline-none focus:ring-violet-500 focus:border-violet-500"
            disabled={isLoadingAssignments}
          >
            {assignments.length === 0 && (
              <option value="" disabled>
                {isLoadingAssignments ? "Loading assignments..." : "No assignments available"}
              </option>
            )}
            {assignments.map((assignment) => (
              <option key={assignment.id} value={assignment.id}>
                {assignment.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      {isLoading ? (
        <div className="flex justify-center items-center h-64">
          <LoadingSpinner animationData={animationData} />
        </div>
      ) : (
        <>
          {selectedAssignment && assignmentAnalytics ? (
            <div className="space-y-6">
              {/* Stats Overview */}
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                <motion.div
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.3 }}
                  className="bg-white p-6 rounded-lg shadow-sm border border-gray-100"
                >
                  <div className="flex justify-between">
                    <h3 className="text-lg font-medium text-gray-900">
                      Average Score
                    </h3>
                    <div className="p-2 bg-violet-100 rounded-full">
                      <ChartBarSquareIcon className="h-6 w-6 text-violet-600" />
                    </div>
                  </div>
                  <p className="mt-2 text-3xl font-bold text-gray-900">
                    {assignmentAnalytics.averageScore.toFixed(1)}%
                  </p>
                  <p className="mt-1 text-sm text-gray-500">
                    Median: {assignmentAnalytics.medianScore.toFixed(1)}%
                  </p>
                </motion.div>

                <motion.div
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.3, delay: 0.1 }}
                  className="bg-white p-6 rounded-lg shadow-sm border border-gray-100"
                >
                  <div className="flex justify-between">
                    <h3 className="text-lg font-medium text-gray-900">
                      Completion Rate
                    </h3>
                    <div className="p-2 bg-green-100 rounded-full">
                      <CheckCircleIcon className="h-6 w-6 text-green-600" />
                    </div>
                  </div>
                  <p className="mt-2 text-3xl font-bold text-gray-900">
                    {assignmentAnalytics.completionRate.toFixed(1)}%
                  </p>
                  <p className="mt-1 text-sm text-gray-500">
                    {assignmentAnalytics.totalAttempts} total attempts
                  </p>
                </motion.div>

                <motion.div
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.3, delay: 0.2 }}
                  className="bg-white p-6 rounded-lg shadow-sm border border-gray-100"
                >
                  <div className="flex justify-between">
                    <h3 className="text-lg font-medium text-gray-900">
                      Average Time
                    </h3>
                    <div className="p-2 bg-blue-100 rounded-full">
                      <ClockIcon className="h-6 w-6 text-blue-600" />
                    </div>
                  </div>
                  <p className="mt-2 text-3xl font-bold text-gray-900">
                    {assignmentAnalytics.averageCompletionTime} min
                  </p>
                  <p className="mt-1 text-sm text-gray-500">
                    {selectedAssignment.timeEstimateMinutes
                      ? `Estimated: ${selectedAssignment.timeEstimateMinutes} min`
                      : "No time estimate set"}
                  </p>
                </motion.div>

                <motion.div
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.3, delay: 0.3 }}
                  className="bg-white p-6 rounded-lg shadow-sm border border-gray-100"
                >
                  <div className="flex justify-between">
                    <h3 className="text-lg font-medium text-gray-900">
                      Active Learners
                    </h3>
                    <div className="p-2 bg-amber-100 rounded-full">
                      <UserGroupIcon className="h-6 w-6 text-amber-600" />
                    </div>
                  </div>
                  <p className="mt-2 text-3xl font-bold text-gray-900">
                    {assignmentAnalytics.totalAttempts}
                  </p>
                  <p className="mt-1 text-sm text-gray-500">
                    Unique submissions
                  </p>
                </motion.div>
              </div>

              {/* Charts */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* Score Distribution */}
                <motion.div
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.3, delay: 0.4 }}
                  className="bg-white p-6 rounded-lg shadow-sm border border-gray-100"
                >
                  <h3 className="text-lg font-medium text-gray-900 mb-4">
                    Score Distribution
                  </h3>
                  <div className="h-72">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart
                        data={assignmentAnalytics.scoreDistribution}
                        margin={{ top: 5, right: 30, left: 20, bottom: 5 }}
                      >
                        <CartesianGrid strokeDasharray="3 3" />
                        <XAxis dataKey="range" />
                        <YAxis />
                        <Tooltip
                          formatter={(value) => [`${value} students`, "Count"]}
                          labelFormatter={(value) => `Score: ${value}`}
                        />
                        <Bar
                          dataKey="count"
                          fill="#8884d8"
                          name="Number of Students"
                        />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </motion.div>

                {/* Question Performance */}
                <motion.div
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.3, delay: 0.5 }}
                  className="bg-white p-6 rounded-lg shadow-sm border border-gray-100"
                >
                  <h3 className="text-lg font-medium text-gray-900 mb-4">
                    Question Performance
                  </h3>
                  <div className="h-72">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart
                        data={assignmentAnalytics.questionBreakdown}
                        margin={{ top: 5, right: 30, left: 20, bottom: 5 }}
                        layout="vertical"
                      >
                        <CartesianGrid strokeDasharray="3 3" />
                        <XAxis type="number" domain={[0, 100]} />
                        <YAxis
                          dataKey="questionId"
                          type="category"
                          tick={{ fontSize: 12 }}
                          tickFormatter={(value) => `Q${value}`}
                        />
                        <Tooltip
                          formatter={(value) =>
                            typeof value === "number"
                              ? [`${value.toFixed(1)}%`, ""]
                              : [value, ""]
                          }
                          labelFormatter={(value) => `Question ${value}`}
                        />
                        <Legend />
                        <Bar
                          dataKey="averageScore"
                          fill="#82ca9d"
                          name="Avg. Score %"
                        />
                        <Bar
                          dataKey="incorrectRate"
                          fill="#ff8042"
                          name="Incorrect %"
                        />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </motion.div>

                {/* Completion Rate Pie Chart */}
                <motion.div
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.3, delay: 0.6 }}
                  className="bg-white p-6 rounded-lg shadow-sm border border-gray-100"
                >
                  <h3 className="text-lg font-medium text-gray-900 mb-4">
                    Assignment Completion
                  </h3>
                  <div className="h-72 flex items-center justify-center">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie
                          data={[
                            {
                              name: "Completed",
                              value: assignmentAnalytics.completionRate,
                            },
                            {
                              name: "Incomplete",
                              value: 100 - assignmentAnalytics.completionRate,
                            },
                          ]}
                          cx="50%"
                          cy="50%"
                          labelLine={false}
                          outerRadius={80}
                          fill="#8884d8"
                          dataKey="value"
                          label={({ name, percent }) =>
                            `${name}: ${(percent * 100).toFixed(1)}%`
                          }
                        >
                          <Cell fill="#82ca9d" />
                          <Cell fill="#ff8042" />
                        </Pie>
                        <Tooltip
                          formatter={(value) =>
                            typeof value === "number"
                              ? [`${value.toFixed(1)}%`, ""]
                              : [value, ""]
                          }
                        />
                        <Legend />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                </motion.div>

                {/* Passing Rates */}
                <motion.div
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.3, delay: 0.7 }}
                  className="bg-white p-6 rounded-lg shadow-sm border border-gray-100"
                >
                  <h3 className="text-lg font-medium text-gray-900 mb-4">
                    Pass/Fail Analysis
                  </h3>
                  <div className="h-72 flex items-center justify-center">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie
                          data={[
                            {
                              name: "Pass",
                              value: assignmentAnalytics.scoreDistribution
                                .filter((item) => parseInt(item.range) >= 50)
                                .reduce((acc, item) => acc + item.count, 0),
                            },
                            {
                              name: "Fail",
                              value: assignmentAnalytics.scoreDistribution
                                .filter((item) => parseInt(item.range) < 50)
                                .reduce((acc, item) => acc + item.count, 0),
                            },
                          ]}
                          cx="50%"
                          cy="50%"
                          labelLine={false}
                          outerRadius={80}
                          fill="#8884d8"
                          dataKey="value"
                          label={({ name, value, percent }) =>
                            `${name}: ${value} (${(percent * 100).toFixed(1)}%)`
                          }
                        >
                          <Cell fill="#4ade80" />
                          <Cell fill="#f87171" />
                        </Pie>
                        <Tooltip
                          formatter={(value) => [`${value} students`, ""]}
                        />
                        <Legend />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                </motion.div>
              </div>

              {/* Detailed Tables */}
              <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-100">
                <h3 className="text-lg font-medium text-gray-900 mb-4">
                  Question-by-Question Breakdown
                </h3>
                <div className="overflow-x-auto">
                  <table className="min-w-full divide-y divide-gray-200">
                    <thead className="bg-gray-50">
                      <tr>
                        <th
                          scope="col"
                          className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider"
                        >
                          Question
                        </th>
                        <th
                          scope="col"
                          className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider"
                        >
                          Avg. Score (%)
                        </th>
                        <th
                          scope="col"
                          className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider"
                        >
                          Incorrect Rate (%)
                        </th>
                        <th
                          scope="col"
                          className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider"
                        >
                          Performance
                        </th>
                      </tr>
                    </thead>
                    <tbody className="bg-white divide-y divide-gray-200">
                      {assignmentAnalytics.questionBreakdown.map(
                        (question, index) => (
                          <tr key={question.questionId}>
                            <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                              Question {question.questionId}
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                              {question.averageScore.toFixed(1)}%
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                              {question.incorrectRate.toFixed(1)}%
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap">
                              <div className="w-40 h-2 bg-gray-200 rounded-full overflow-hidden">
                                <div
                                  className={`h-full ${
                                    question.averageScore >= 80
                                      ? "bg-green-500"
                                      : question.averageScore >= 60
                                        ? "bg-yellow-500"
                                        : "bg-red-500"
                                  }`}
                                  style={{ width: `${question.averageScore}%` }}
                                ></div>
                              </div>
                            </td>
                          </tr>
                        ),
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Recommendations */}
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.3, delay: 0.8 }}
                className="bg-white p-6 rounded-lg shadow-sm border border-gray-100"
              >
                <div className="flex items-start space-x-3">
                  <div className="p-2 rounded-full bg-violet-100">
                    <ArrowTrendingUpIcon className="h-6 w-6 text-violet-600" />
                  </div>
                  <div>
                    <h3 className="text-lg font-medium text-gray-900 mb-2">
                      Recommendations for Improvement
                    </h3>
                    <ul className="space-y-2 text-gray-700">
                      {assignmentAnalytics.questionBreakdown.some(
                        (q) => q.incorrectRate > 60,
                      ) && (
                        <li className="flex items-start">
                          <span className="text-red-500 mr-2">•</span>
                          <span>
                            Review questions with high incorrect rates (above
                            60%) to clarify instructions or adjust difficulty.
                          </span>
                        </li>
                      )}

                      {assignmentAnalytics.averageCompletionTime >
                        (selectedAssignment.timeEstimateMinutes || 30) *
                          1.3 && (
                        <li className="flex items-start">
                          <span className="text-amber-500 mr-2">•</span>
                          <span>
                            Average completion time exceeds the estimated time
                            by 30%. Consider increasing the time estimate or
                            reducing the number of questions.
                          </span>
                        </li>
                      )}

                      {assignmentAnalytics.completionRate < 70 && (
                        <li className="flex items-start">
                          <span className="text-amber-500 mr-2">•</span>
                          <span>
                            The completion rate is below 70%. This may indicate
                            the assignment is too difficult or too long.
                          </span>
                        </li>
                      )}

                      {assignmentAnalytics.averageScore < 65 && (
                        <li className="flex items-start">
                          <span className="text-red-500 mr-2">•</span>
                          <span>
                            Low average score suggests learners are struggling
                            with the content. Consider providing additional
                            resources or simplifying questions.
                          </span>
                        </li>
                      )}

                      {!assignmentAnalytics.questionBreakdown.some(
                        (q) => q.incorrectRate > 50,
                      ) &&
                        assignmentAnalytics.completionRate > 80 &&
                        assignmentAnalytics.averageScore > 80 && (
                          <li className="flex items-start">
                            <span className="text-green-500 mr-2">•</span>
                            <span>
                              The assignment shows excellent metrics. Consider
                              adding more challenging content for advanced
                              learners.
                            </span>
                          </li>
                        )}
                    </ul>
                  </div>
                </div>
              </motion.div>
            </div>
          ) : (
            <div className="bg-white p-12 rounded-lg shadow-sm border border-gray-100 text-center">
              <QuestionMarkCircleIcon className="w-16 h-16 mx-auto text-gray-400" />
              <h3 className="mt-4 text-lg font-medium text-gray-900">
                {selectedAssignment
                  ? "No analytics available for this assignment yet"
                  : "Select an assignment to view analytics"}
              </h3>
              <p className="mt-2 text-gray-500">
                {selectedAssignment
                  ? "Analytics will appear here when learners complete the assignment"
                  : "Choose an assignment from the dropdown above"}
              </p>
            </div>
          )}
        </>
      )}
    </div>
  );
}