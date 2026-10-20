import { PrismaClient, type Prisma } from "@prisma/client";
import { createHash } from "node:crypto";
import {
  contextSql,
  extraSql,
  from,
  MODELS,
  scopeClause,
  valuesSql,
} from "./manifest";
import type { Model, Snapshot, Values } from "./types";

export type Database = Pick<
  Prisma.TransactionClient,
  "$queryRawUnsafe" | "$executeRawUnsafe"
>;
export const digest = (value: unknown): string => {
  const stable = (input: unknown): unknown =>
    Array.isArray(input)
      ? input.map((value) => stable(value))
      : input !== null && typeof input === "object"
        ? Object.fromEntries(
            Object.keys(input)
              .sort()
              .map((key) => [
                key,
                stable((input as Record<string, unknown>)[key]),
              ]),
          )
        : input;
  return createHash("sha256")
    .update(JSON.stringify(stable(value)))
    .digest("hex");
};
export const rows = <T>(
  database: Database,
  sql: string,
  ...parameters: unknown[]
) => database.$queryRawUnsafe<T[]>(sql, ...parameters);
export const execute = (
  database: Database,
  sql: string,
  ...parameters: unknown[]
) => database.$executeRawUnsafe(sql, ...parameters);
export const sizeSql = (model: Model) =>
  [...model.fields, ...(model.auditFields ?? [])]
    .map((field) => `COALESCE(octet_length(r."${field}"::text)::bigint, 0)`)
    .join(" + ");

export async function databaseTarget(
  database: Database,
  url: string,
): Promise<string> {
  const [identity] = await rows(
    database,
    "SELECT current_database() AS database, current_schema() AS schema",
  );
  const endpoint = new URL(url);
  return digest({
    endpoint: endpoint.hostname,
    port: endpoint.port || "5432",
    identity,
  });
}

export async function schemaFingerprint(database: Database): Promise<string> {
  const names = [...MODELS.map((model) => model.name), "AssignmentAttempt"];
  const columns = await rows<{ table_name: string }>(
    database,
    `SELECT table_name, column_name, data_type, udt_name, is_nullable FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = ANY($1::text[]) ORDER BY table_name, ordinal_position`,
    names,
  );
  if (
    new Set(columns.map((column: { table_name: string }) => column.table_name))
      .size !== names.length
  )
    throw new Error("missing-application-tables");
  const triggers = await rows(
    database,
    `SELECT event_object_table, trigger_name, action_statement FROM information_schema.triggers WHERE trigger_schema = current_schema() AND event_object_table = ANY($1::text[]) ORDER BY event_object_table, trigger_name`,
    names,
  );
  const indexes = await rows(
    database,
    `SELECT tablename, indexname, indexdef FROM pg_indexes WHERE schemaname = current_schema() AND tablename = ANY($1::text[]) ORDER BY tablename, indexname`,
    names,
  );
  return digest({ columns, triggers, indexes });
}

export async function readSnapshot(
  database: Database,
  model: Model,
  id: number,
  scope: number[],
  byteLimit: number,
): Promise<Snapshot | undefined> {
  const [snapshot] = await rows<Snapshot>(
    database,
    `SELECT ${valuesSql(model)} AS "values", ${extraSql(model)} AS extra, ${contextSql(model)} AS context ${from(model)} WHERE ${scopeClause(model)} AND r.id = $2 AND (${sizeSql(model)}) <= $3`,
    scope.length > 0 ? scope : null,
    id,
    byteLimit,
  );
  if (snapshot) return snapshot;
  const [present] = await rows<{ exists: boolean }>(
    database,
    `SELECT EXISTS(SELECT 1 ${from(model)} WHERE ${scopeClause(model)} AND r.id = $2) AS exists`,
    scope.length > 0 ? scope : null,
    id,
  );
  if (present.exists) throw new Error("document-size-limit");
  return undefined;
}

export async function lockSource(
  database: Database,
  model: Model,
  id: number,
): Promise<void> {
  await rows(
    database,
    `SELECT id FROM "${model.name}" WHERE id = $1 FOR UPDATE`,
    id,
  );
  if (model.name === "QuestionResponse") {
    const [response] = await rows<{
      assignmentAttemptId: number;
      questionId: number;
    }>(
      database,
      'SELECT "assignmentAttemptId", "questionId" FROM "QuestionResponse" WHERE id = $1',
      id,
    );
    if (response) {
      const [attempt] = await rows<{ assignmentVersionId: number }>(
        database,
        'SELECT "assignmentVersionId" FROM "AssignmentAttempt" WHERE id = $1 FOR SHARE',
        response.assignmentAttemptId,
      );
      if (attempt?.assignmentVersionId)
        await rows(
          database,
          'SELECT id FROM "QuestionVersion" WHERE "assignmentVersionId" = $1 AND "questionId" = $2 ORDER BY id FOR SHARE',
          attempt.assignmentVersionId,
          response.questionId,
        );
      else if (attempt)
        await rows(
          database,
          'SELECT id FROM "Question" WHERE id = $1 FOR SHARE',
          response.questionId,
        );
    }
  }
}

export async function replaceValues(
  database: Database,
  model: Model,
  id: number,
  values: Values,
): Promise<Values> {
  const fields = Object.keys(values);
  if (
    fields.length === 0 ||
    fields.some((field) => !model.fields.includes(field))
  )
    throw new Error("invalid-patch");
  const assignments = fields.map(
    (field, index) =>
      `"${field}" = $${index + 2}${model.jsonFields?.includes(field) ? "::jsonb" : "::text"}`,
  );
  const parameters = fields.map((field) => values[field]);
  await execute(
    database,
    `UPDATE "${model.name}" SET ${assignments.join(", ")} WHERE id = $1`,
    id,
    ...parameters,
  );
  const [actual] = await rows<{ values: Values }>(
    database,
    `SELECT ${valuesSql(model)} AS values ${from(model)} WHERE r.id = $1`,
    id,
  );
  if (
    fields.some(
      (field) =>
        !model.jsonFields?.includes(field) &&
        actual.values[field] !== values[field],
    )
  )
    throw new Error("write-verification-failed");
  const checks = fields.map(
    (field, index) =>
      `r."${field}" IS NOT DISTINCT FROM $${index + 2}${model.jsonFields?.includes(field) ? "::jsonb" : "::text"}`,
  );
  const [verified] = await rows<{ valid: boolean }>(
    database,
    `SELECT (${checks.join(" AND ")}) AS valid ${from(model)} WHERE r.id = $1`,
    id,
    ...parameters,
  );
  if (!verified?.valid) throw new Error("write-verification-failed");
  return Object.fromEntries(
    fields.map((field) => [field, actual.values[field]]),
  );
}

export function connect(url: string): PrismaClient {
  const target = new URL(url);
  if (!["postgres:", "postgresql:"].includes(target.protocol))
    throw new Error("postgres-url-required");
  target.searchParams.set("connection_limit", "3");
  return new PrismaClient({ datasources: { db: { url: target.toString() } } });
}
