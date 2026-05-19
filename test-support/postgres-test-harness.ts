export interface PostgresTestEnvironmentAvailability {
  available: boolean;
  reason?: string;
}

/**
 * Skip-if-unavailable gate for integration specs that boot a real PrismaClient.
 * Mirrors test-support/redis-test-harness.ts shape.
 */
export function getPostgresTestEnvironmentAvailability(): PostgresTestEnvironmentAvailability {
  if (!process.env.DATABASE_URL) {
    return { available: false, reason: "DATABASE_URL unset" };
  }
  return { available: true };
}

export function isPostgresTestEnvironmentAvailable(): boolean {
  return getPostgresTestEnvironmentAvailability().available;
}
