export type Values = Record<string, string | null>;
export interface Snapshot {
  values: Values;
  context: string | null;
  extra?: Values;
}
export interface Model {
  name: string;
  fields: string[];
  jsonFields?: string[];
  scope: string;
  context?: string;
  joins?: string;
  auditFields?: string[];
  auditJsonFields?: string[];
}
export interface Conversion {
  state: "pending" | "unchanged" | "quarantined";
  before: Values;
  after: Values;
  reason?: string;
  rules: string[];
}
export interface Run {
  id: string;
  target: string;
  fingerprint: string;
  scope: number[];
  origin: string;
  status: string;
  cursor: Record<string, number>;
  upper: Record<string, number>;
  cleanSweeps: number;
  byteLimit: number;
  operation: string;
}
export interface Item {
  id: string;
  model: string;
  rowId: number;
  sourceHash: string;
  context: string | null;
  destinationHash: string | null;
  state: string;
  reason: string | null;
  attempts: number;
}
