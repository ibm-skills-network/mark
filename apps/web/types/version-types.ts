import { VersionSummary } from "@/lib/author";

export interface VersionChangeDto {
  field: string;
  fromValue: any;
  toValue: any;
  changeType: "added" | "modified" | "removed";
}

export interface QuestionChangeDto {
  questionId?: number;
  displayOrder: number;
  changeType: "added" | "modified" | "removed";
  field?: string;
  fromValue?: any;
  toValue?: any;
}

export interface VersionComparison {
  fromVersion: VersionSummary;
  toVersion: VersionSummary;
  assignmentChanges: VersionChangeDto[];
  questionChanges: QuestionChangeDto[];
}
