import { getRedisClient } from "../redis/client";

export class SequenceNumberAllocator {
  async next(meetingId: string): Promise<number> {
    const client = await getRedisClient();
    return client.incr(`meeting:${meetingId}:seq`);
  }
}
