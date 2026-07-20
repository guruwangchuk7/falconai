import { describe, it, expect, vi } from "vitest";
import { KnowledgeGraphWorker } from "../../src/knowledgeGraph/knowledgeGraphWorker";

function makeDeps(overrides: Record<string, unknown> = {}) {
  return {
    buildStore: {
      findMeetingsNeedingBuild: vi.fn().mockResolvedValue([]),
      markProcessing: vi.fn().mockResolvedValue(undefined),
      markCompleted: vi.fn().mockResolvedValue(undefined),
      markFailed: vi.fn().mockResolvedValue(undefined),
    },
    fetcher: {
      fetchFormattedTranscript: vi.fn().mockResolvedValue({ promptText: "", participants: [] }),
    },
    extractor: {
      extract: vi.fn().mockResolvedValue({ decisions: [], topics: [] }),
    },
    writer: {
      writeGraph: vi.fn().mockResolvedValue(undefined),
    },
    onAlert: vi.fn(),
    writerRetry: { retries: 2, baseDelayMs: 1 },
    ...overrides,
  };
}

describe("KnowledgeGraphWorker", () => {
  it("does nothing when there are no candidate meetings", async () => {
    const deps = makeDeps();
    const worker = new KnowledgeGraphWorker(deps as any);

    await worker.pollOnce();

    expect(deps.buildStore.markProcessing).not.toHaveBeenCalled();
    expect(deps.fetcher.fetchFormattedTranscript).not.toHaveBeenCalled();
  });

  it("processes each candidate meeting in order: mark processing, fetch, extract, write, mark completed", async () => {
    const deps = makeDeps({
      buildStore: {
        findMeetingsNeedingBuild: vi.fn().mockResolvedValue(["m1", "m2"]),
        markProcessing: vi.fn().mockResolvedValue(undefined),
        markCompleted: vi.fn().mockResolvedValue(undefined),
        markFailed: vi.fn().mockResolvedValue(undefined),
      },
    });
    const worker = new KnowledgeGraphWorker(deps as any);

    await worker.pollOnce();

    expect(deps.buildStore.markProcessing).toHaveBeenNthCalledWith(1, "m1");
    expect(deps.buildStore.markProcessing).toHaveBeenNthCalledWith(2, "m2");
    expect(deps.fetcher.fetchFormattedTranscript).toHaveBeenCalledWith("m1");
    expect(deps.fetcher.fetchFormattedTranscript).toHaveBeenCalledWith("m2");
    expect(deps.buildStore.markCompleted).toHaveBeenCalledWith("m1");
    expect(deps.buildStore.markCompleted).toHaveBeenCalledWith("m2");
  });

  it("marks a meeting failed and alerts, without marking it completed, when extraction throws", async () => {
    const deps = makeDeps({
      buildStore: {
        findMeetingsNeedingBuild: vi.fn().mockResolvedValue(["m1"]),
        markProcessing: vi.fn().mockResolvedValue(undefined),
        markCompleted: vi.fn().mockResolvedValue(undefined),
        markFailed: vi.fn().mockResolvedValue(undefined),
      },
      extractor: { extract: vi.fn().mockRejectedValue(new Error("Claude API down")) },
    });
    const worker = new KnowledgeGraphWorker(deps as any);

    await worker.pollOnce();

    expect(deps.buildStore.markFailed).toHaveBeenCalledWith("m1", "Claude API down");
    expect(deps.buildStore.markCompleted).not.toHaveBeenCalled();
    expect(deps.onAlert).toHaveBeenCalledWith(
      expect.stringContaining("m1"),
      expect.any(Error)
    );
  });

  it("retries a failing writeGraph call before succeeding", async () => {
    const writeGraph = vi
      .fn()
      .mockRejectedValueOnce(new Error("connection reset"))
      .mockResolvedValueOnce(undefined);
    const deps = makeDeps({
      buildStore: {
        findMeetingsNeedingBuild: vi.fn().mockResolvedValue(["m1"]),
        markProcessing: vi.fn().mockResolvedValue(undefined),
        markCompleted: vi.fn().mockResolvedValue(undefined),
        markFailed: vi.fn().mockResolvedValue(undefined),
      },
      writer: { writeGraph },
    });
    const worker = new KnowledgeGraphWorker(deps as any);

    await worker.pollOnce();

    expect(writeGraph).toHaveBeenCalledTimes(2);
    expect(deps.buildStore.markCompleted).toHaveBeenCalledWith("m1");
    expect(deps.buildStore.markFailed).not.toHaveBeenCalled();
  });

  it("marks failed once the writer's retries are exhausted", async () => {
    const deps = makeDeps({
      buildStore: {
        findMeetingsNeedingBuild: vi.fn().mockResolvedValue(["m1"]),
        markProcessing: vi.fn().mockResolvedValue(undefined),
        markCompleted: vi.fn().mockResolvedValue(undefined),
        markFailed: vi.fn().mockResolvedValue(undefined),
      },
      writer: { writeGraph: vi.fn().mockRejectedValue(new Error("db down")) },
      writerRetry: { retries: 1, baseDelayMs: 1 },
    });
    const worker = new KnowledgeGraphWorker(deps as any);

    await worker.pollOnce();

    expect(deps.writer.writeGraph).toHaveBeenCalledTimes(2);
    expect(deps.buildStore.markFailed).toHaveBeenCalledWith("m1", "db down");
    expect(deps.buildStore.markCompleted).not.toHaveBeenCalled();
  });
});
