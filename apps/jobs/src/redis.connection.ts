// The worker shares the API's connection factory so both sides read the same
// REDIS_URL / REDIS_SENTINEL_HOSTS configuration and follow Sentinel failovers
// identically.
export {
  createRedisConnection,
  getRedisUrl,
} from "../../api/src/job-queue/redis.connection";
