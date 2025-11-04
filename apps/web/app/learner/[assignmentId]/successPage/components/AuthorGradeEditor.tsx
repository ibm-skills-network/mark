"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Check, X, Edit2, Save } from "lucide-react";

interface QuestionGrade {
  questionId: number;
  questionNumber: number;
  questionText: string;
  totalPoints: number;
  earnedPoints: number;
  feedback?: string;
}

interface AuthorGradeEditorProps {
  questions: QuestionGrade[];
  attemptId: number;
  assignmentId: number;
  regradingRequestId?: string;
  onSave: (grades: Record<number, number>) => Promise<void>;
  onCancel: () => void;
}

export function AuthorGradeEditor({
  questions,
  attemptId,
  assignmentId,
  regradingRequestId,
  onSave,
  onCancel,
}: AuthorGradeEditorProps) {
  const [editedGrades, setEditedGrades] = useState<Record<number, number>>({});
  const [editingQuestion, setEditingQuestion] = useState<number | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const handleGradeChange = (questionId: number, newGrade: number) => {
    const question = questions.find((q) => q.questionId === questionId);
    if (!question) return;

    if (newGrade < 0 || newGrade > question.totalPoints) {
      toast.error(`Grade must be between 0 and ${question.totalPoints} points`);
      return;
    }

    setEditedGrades((prev) => ({
      ...prev,
      [questionId]: newGrade,
    }));
  };

  const getCurrentGrade = (question: QuestionGrade) => {
    return editedGrades[question.questionId] ?? question.earnedPoints;
  };

  const hasChanges = Object.keys(editedGrades).length > 0;

  const getTotalPoints = () => {
    return questions.reduce((sum, q) => sum + q.totalPoints, 0);
  };

  const getTotalEarned = () => {
    return questions.reduce((sum, q) => sum + getCurrentGrade(q), 0);
  };

  const handleSave = async () => {
    if (!hasChanges) {
      toast.info("No changes to save");
      return;
    }

    setIsSaving(true);
    try {
      await onSave(editedGrades);
      toast.success("Grades updated successfully");
    } catch (error) {
      toast.error("Failed to save grades");
    } finally {
      setIsSaving(false);
    }
  };

  const getGradeChangeIndicator = (question: QuestionGrade) => {
    if (editedGrades[question.questionId] === undefined) return null;

    const change = editedGrades[question.questionId] - question.earnedPoints;
    if (change === 0) return null;

    return (
      <Badge variant={change > 0 ? "default" : "destructive"} className="ml-2">
        {change > 0 ? "+" : ""}
        {change.toFixed(1)}
      </Badge>
    );
  };

  return (
    <div className="space-y-4">
      <Card className="border-blue-200 bg-blue-50">
        <CardHeader>
          <CardTitle className="text-blue-900 flex items-center gap-2">
            <Edit2 className="h-5 w-5" />
            Author Review Mode
            {regradingRequestId && (
              <Badge variant="outline" className="ml-auto">
                Request #{regradingRequestId}
              </Badge>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <div className="flex justify-between items-center">
              <div>
                <p className="text-sm text-gray-700">
                  Review and modify grades for individual questions below
                </p>
                <p className="text-xs text-gray-500 mt-1">
                  Total: {getTotalEarned().toFixed(1)} / {getTotalPoints()}{" "}
                  points (
                  {((getTotalEarned() / getTotalPoints()) * 100).toFixed(1)}%)
                </p>
              </div>
              <div className="flex gap-2">
                <Button
                  onClick={onCancel}
                  variant="outline"
                  disabled={isSaving}
                >
                  <X className="h-4 w-4 mr-2" />
                  Cancel
                </Button>
                <Button onClick={handleSave} disabled={!hasChanges || isSaving}>
                  <Save className="h-4 w-4 mr-2" />
                  {isSaving ? "Saving..." : "Save Changes"}
                </Button>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="space-y-3">
        {questions.map((question, index) => (
          <Card
            key={question.questionId}
            className={
              editedGrades[question.questionId] !== undefined
                ? "border-blue-300 bg-blue-50"
                : ""
            }
          >
            <CardContent className="pt-6">
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-2">
                    <Badge variant="outline">Question {index + 1}</Badge>
                    <span className="text-sm font-medium text-gray-700">
                      {question.totalPoints} points
                    </span>
                  </div>
                  <p className="text-sm text-gray-600 mb-3 line-clamp-2">
                    {question.questionText}
                  </p>

                  {question.feedback && (
                    <div className="bg-gray-50 p-3 rounded-md mb-3">
                      <p className="text-xs font-semibold text-gray-700 mb-1">
                        Grading Feedback:
                      </p>
                      <p className="text-xs text-gray-600">
                        {question.feedback}
                      </p>
                    </div>
                  )}
                </div>

                <div className="ml-4 flex items-center gap-3">
                  <div className="text-right">
                    <p className="text-xs text-gray-500 mb-1">Grade</p>
                    {editingQuestion === question.questionId ? (
                      <div className="flex items-center gap-2">
                        <Input
                          type="number"
                          min={0}
                          max={question.totalPoints}
                          step={0.5}
                          value={getCurrentGrade(question)}
                          onChange={(e) =>
                            handleGradeChange(
                              question.questionId,
                              parseFloat(e.target.value) || 0,
                            )
                          }
                          className="w-20 h-8 text-sm"
                          autoFocus
                          onBlur={() => setEditingQuestion(null)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") {
                              setEditingQuestion(null);
                            } else if (e.key === "Escape") {
                              setEditedGrades((prev) => {
                                const newGrades = { ...prev };
                                delete newGrades[question.questionId];
                                return newGrades;
                              });
                              setEditingQuestion(null);
                            }
                          }}
                        />
                        <span className="text-sm text-gray-500">
                          / {question.totalPoints}
                        </span>
                      </div>
                    ) : (
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() =>
                            setEditingQuestion(question.questionId)
                          }
                          className="text-xl font-bold text-blue-600 hover:text-blue-800 hover:underline cursor-pointer"
                        >
                          {getCurrentGrade(question).toFixed(1)}
                        </button>
                        <span className="text-sm text-gray-500">
                          / {question.totalPoints}
                        </span>
                        {getGradeChangeIndicator(question)}
                      </div>
                    )}
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setEditingQuestion(question.questionId)}
                    className="h-8"
                  >
                    <Edit2 className="h-3 w-3" />
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {hasChanges && (
        <Card className="border-yellow-300 bg-yellow-50">
          <CardContent className="pt-4">
            <p className="text-sm text-yellow-800">
              <strong>You have unsaved changes.</strong>{" "}
              {Object.keys(editedGrades).length} question
              {Object.keys(editedGrades).length !== 1 ? "s" : ""} modified.
              Click "Save Changes" to update the grades.
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
