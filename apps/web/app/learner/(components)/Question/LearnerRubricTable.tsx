import React from "react";

interface Criterion {
  description: string;
  points: number;
}

interface SingleRubric {
  rubricQuestion: string;
  criteria: Criterion[];
}

interface LearnerRubricTableProps {
  rubrics: SingleRubric[];
  showPoints: boolean;
}

function LearnerRubricTable({ rubrics, showPoints }: LearnerRubricTableProps) {
  if (!rubrics || rubrics.length === 0) return null;

  return (
    <div className="flex flex-col gap-y-4 px-4">
      {rubrics.map((rubric, i) => (
        <div key={i} className="flex flex-col gap-y-2">
          <h4 className="text-gray-700 text-md font-semibold">
            Sub Question {i + 1}: {rubric.rubricQuestion}
          </h4>
          <div className="overflow-x-auto">
            <table className="w-full text-left border border-gray-300 overflow-hidden">
              <thead className="bg-gray-100 border-b border-gray-300">
                <tr>
                  <th className="p-2 text-gray-700 font-semibold">
                    Description
                  </th>
                  {showPoints && (
                    <th className="p-2 text-gray-700 font-semibold text-center">
                      Points
                    </th>
                  )}
                </tr>
              </thead>
              <tbody>
                {rubric.criteria.map((criterion, index) => (
                  <tr
                    key={index}
                    className="border-b border-gray-300 last:border-0"
                  >
                    <td className="p-2 text-gray-600 max-w-sm text-wrap overflow-hidden">
                      {criterion.description}
                    </td>
                    {showPoints && (
                      <td className="p-2 text-gray-600 text-center">
                        {criterion.points}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ))}
    </div>
  );
}

export default LearnerRubricTable;
