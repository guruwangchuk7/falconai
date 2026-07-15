import { createClient, type RedisClientType } from "redis";

let clientPromise: Promise<RedisClientType> | undefined;

export async function getRedisClient(): Promise<RedisClientType> {
  if (!clientPromise) {
    clientPromise = (async () => {
      const client = createClient({ url: process.env.REDIS_URL });
      client.on("error", (err) => console.error("Redis client error", err));
      await client.connect();
      return client;
    })();
  }
  return clientPromise;
}

export async function closeRedisClient(): Promise<void> {
  if (clientPromise) {
    const client = await clientPromise;
    await client.quit();
    clientPromise = undefined;
  }
}
