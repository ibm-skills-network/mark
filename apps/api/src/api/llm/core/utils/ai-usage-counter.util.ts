const MAX_SAFE_INTEGER_BIGINT = BigInt(Number.MAX_SAFE_INTEGER);

export function toAiUsageCounterBigInt(
  value: number,
  fieldName: string,
): bigint {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(
      `${fieldName} must be a non-negative safe integer. Received: ${value}`,
    );
  }

  return BigInt(value);
}

export function toAiUsageCounterNumber(
  value: bigint | number,
  fieldName: string,
): number {
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new RangeError(
        `${fieldName} must be a non-negative safe integer. Received: ${value}`,
      );
    }

    return value;
  }

  if (value > MAX_SAFE_INTEGER_BIGINT) {
    throw new RangeError(
      `${fieldName} exceeds Number.MAX_SAFE_INTEGER and cannot be serialized safely`,
    );
  }

  return Number(value);
}
