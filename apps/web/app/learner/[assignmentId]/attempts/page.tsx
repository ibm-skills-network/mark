"use client";

import {
  useAssignmentDetails,
  useLearnerOverviewStore,
} from "@/stores/learner";
import React, { useMemo, useState } from "react";
import DataTable, {
  createTheme,
  TableColumn,
} from "react-data-table-component";

createTheme("whiteVioletTheme", {
  text: {
    primary: "black",
    secondary: "black",
  },
  background: {
    default: "#FFFFFF",
  },
  context: {
    background: "#F5F3FF",
    text: "#4C1D95",
  },
  divider: {
    default: "#E5E7EB",
  },
  highlightOnHover: {
    default: "#F5F3FF",
    text: "#4C1D95",
  },
  striped: {
    default: "#F5F3FF",
    text: "#4C1D95",
  },
});

interface AttemptTableRow {
  id: number;
  assignmentId?: number;
  attemptNumber: number;
  scoreDisplay: string;
  scoreNumeric: number;
  startedAt: string;
  expiresAt: string;
  duration: string;
  isLatest: boolean;
}

export default function AssignmentAttempts() {
  const listOfAttempts = useLearnerOverviewStore(
    (state) => state.listOfAttempts
  );
  const [assignmentDetails] = useAssignmentDetails((state) => [
    state.assignmentDetails,
  ]);

  const sortedAttempts = [...listOfAttempts].sort((a, b) =>
    a.createdAt && b.createdAt
      ? new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      : 0
  );

  const attemptsData: AttemptTableRow[] = useMemo(
    () =>
      sortedAttempts.map((attempt, index) => {
        const attemptNumber = sortedAttempts.length - index;
        const grade = attempt.grade ?? null;

        const scoreDisplay =
          grade !== null ? `${Math.round(grade * 100)}%` : "N/A";
        const scoreNumeric = grade !== null ? grade * 100 : -1;

        const startedAt = attempt.createdAt
          ? new Date(attempt.createdAt).toLocaleString("en-US", {
              month: "short",
              day: "numeric",
              year: "numeric",
              hour: "numeric",
              minute: "numeric",
              hour12: true,
            })
          : "N/A";
        const expiresAt = attempt.expiresAt
          ? new Date(attempt.expiresAt).toLocaleString("en-US", {
              month: "short",
              day: "numeric",
              year: "numeric",
              hour: "numeric",
              minute: "numeric",
              hour12: true,
            })
          : "N/A";

        let duration = "N/A";
        if (attempt.createdAt && attempt.expiresAt) {
          const start = new Date(attempt.createdAt).getTime();
          const end = new Date(attempt.expiresAt).getTime();
          const diffInSeconds = (end - start) / 1000;
          if (diffInSeconds >= 0) {
            const hours = Math.floor(diffInSeconds / 3600);
            const minutes = Math.floor((diffInSeconds % 3600) / 60);
            const seconds = Math.floor(diffInSeconds % 60);
            duration = `${hours}h ${minutes}m ${seconds}s`;
          }
        }

        return {
          id: attempt.id,
          assignmentId: attempt.assignmentId,
          attemptNumber,
          scoreDisplay,
          scoreNumeric,
          startedAt,
          expiresAt,
          duration,
          isLatest: index === 0,
        };
      }),
    [sortedAttempts]
  );

  const columns = useMemo<TableColumn<AttemptTableRow>[]>(
    () => [
      {
        name: "Attempt #",
        selector: (row) => row.attemptNumber,
        sortable: true,
        width: "105px",
      },
      {
        name: "Score",
        selector: (row) => row.scoreNumeric,
        sortable: true,
        sortFunction: (rowA, rowB) => rowA.scoreNumeric - rowB.scoreNumeric,
        cell: (row) => {
          return (
            <div className="flex items-center gap-2">
              <div className="w-16 h-2 bg-gray-300 rounded overflow-hidden">
                {row.scoreNumeric >= 0 && (
                  <div
                    className="h-full bg-green-500 transition-all duration-300"
                    style={{
                      width: `${row.scoreNumeric}%`,
                    }}
                  />
                )}
              </div>
              <span>{row.scoreDisplay}</span>
            </div>
          );
        },
        grow: 2,
      },
      {
        name: "Started At",
        selector: (row) => row.startedAt,
        sortable: true,
        grow: 2,
      },
      {
        name: "Expires At",
        selector: (row) => row.expiresAt,
        sortable: true,
        grow: 2,
      },
      {
        name: "Duration",
        selector: (row) => row.duration,
        sortable: true,
        grow: 2,
      },
      {
        name: "Action",
        cell: (row) => (
          <button
            onClick={() => {
              window.open(
                `/learner/${row.assignmentId}/successPage/${row.id}`,
                "_self"
              );
            }}
            className="flex items-center gap-1 text-blue-600 hover:text-violet-600 underline"
            aria-label={`View details for Attempt ${row.attemptNumber}`}
          >
            View
          </button>
        ),
        ignoreRowClick: true,
        allowOverflow: false,
        button: true,
        width: "70px",
      },
    ],
    []
  );

  const [filterText, setFilterText] = useState("");

  const filteredData = useMemo(() => {
    if (!filterText) return attemptsData;
    const lower = filterText.toLowerCase();
    return attemptsData.filter((item) => {
      return (
        item.attemptNumber.toString().toLowerCase().includes(lower) ||
        item.scoreDisplay.toLowerCase().includes(lower) ||
        item.startedAt.toLowerCase().includes(lower) ||
        item.expiresAt.toLowerCase().includes(lower) ||
        item.duration.toLowerCase().includes(lower)
      );
    });
  }, [filterText, attemptsData]);

  return (
    <div className="flex justify-center pt-10 bg-gray-50 flex-1">
      <div className="w-full max-w-7xl p-6 bg-white rounded shadow-sm h-fit">
        <h1 className="text-2xl font-bold mb-4">
          {assignmentDetails?.name || "Assignment"} Attempts
        </h1>

        {/* Search Box */}
        <div className="mb-4">
          <input
            type="text"
            value={filterText}
            onChange={(e) => setFilterText(e.target.value)}
            placeholder="Search attempts, scores, dates, etc."
            className="border border-gray-300 rounded px-3 py-2 w-full"
          />
        </div>

        {attemptsData.length > 0 ? (
          <DataTable
            columns={columns}
            data={filteredData}
            highlightOnHover
            pointerOnHover
            defaultSortFieldId={2}
            defaultSortAsc={false}
            theme="whiteVioletTheme"
            pagination
          />
        ) : (
          <div className="text-center text-gray-600 py-6">
            No attempts found for this assignment.
          </div>
        )}
      </div>
    </div>
  );
}
