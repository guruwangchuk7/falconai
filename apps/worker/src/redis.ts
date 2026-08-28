import { Redis } from 'ioredis';
import { loadEnv, redisEnv } from '@falcon/config';

const env = loadEnv(redisEnv);
// BullMQ requires maxRetriesPerRequest: null on the connection.
export const connection = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });
