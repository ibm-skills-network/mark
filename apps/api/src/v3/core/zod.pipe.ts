import type { ArgumentMetadata, PipeTransform } from "@nestjs/common";
import type { z, ZodError, ZodType } from "zod";
import { V3Error } from "./errors";

/** Issue paths and codes only: values can be learner content or secrets. */
export function issueSummary(
  error: ZodError,
): Array<{ path: string; code: string }> {
  return error.issues.map((issue) => ({
    path: issue.path.map(String).join("."),
    code: issue.code,
  }));
}

/** Validates a body, query or param with a zod schema; failure is 400. */
export class ZodPipe<T extends ZodType>
  implements PipeTransform<unknown, z.output<T>>
{
  constructor(private readonly schema: T) {}

  transform(value: unknown, metadata: ArgumentMetadata): z.output<T> {
    const result = this.schema.safeParse(value);
    if (result.success) return result.data;
    throw V3Error.badRequest(`${metadata.type}_invalid`, "Invalid request", {
      issues: issueSummary(result.error),
    });
  }
}
