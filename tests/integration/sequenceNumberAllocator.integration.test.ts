import "dotenv/config";
import { describe, it, expect, afterAll } from "vitest";
import { SequenceNumberAllocator } from "../../src/pipeline/sequenceNumberAllocator";
import { closeRedisClient, getRedisClient } from "../../src/redis/client";

describe("SequenceNumberAllocator", () => {
  afterAll(async () => {
    await closeRedisClient();
  });

  it("returns increasing numbers per meeting, independent across meetings", async () => {
    const allocator = new SequenceNumberAllocator();
    const client = await getRedisClient();
    await client.del("meeting:seq-test-a:seq");
    await client.del("meeting:seq-test-b:seq");

    expect(await allocator.next("seq-test-a")).toBe(1);
    expect(await allocator.next("seq-test-a")).toBe(2);
    expect(await allocator.next("seq-test-b")).toBe(1);
  });
});
