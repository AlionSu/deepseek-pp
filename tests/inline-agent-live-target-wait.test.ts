import { afterEach, describe, expect, it, vi } from "vitest";
import { waitForInlineAgentLiveTarget } from "../core/inline-agent/live-target-wait";

describe("waitForInlineAgentLiveTarget", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns an immediately available target without allocating resources", async () => {
    const observe = vi.fn(() => vi.fn());
    const scheduleTimeout = vi.fn(() => 1);
    const target = { id: "assistant-1" };

    await expect(
      waitForInlineAgentLiveTarget({
        find: () => target,
        observe,
        scheduleTimeout,
        clearScheduledTimeout: vi.fn(),
        signal: new AbortController().signal,
        timeoutMs: 1500,
      }),
    ).resolves.toBe(target);

    expect(observe).not.toHaveBeenCalled();
    expect(scheduleTimeout).not.toHaveBeenCalled();
  });

  it("resolves when the assistant target mounts after RESPONSE_COMPLETE and cleans up", async () => {
    vi.useFakeTimers();
    let target: { id: string } | null = null;
    let notifyMutation: () => void = () => {
      throw new Error("observer callback was not registered");
    };
    const stopObserving = vi.fn();
    const clearScheduledTimeout = vi.fn(
      (timer: ReturnType<typeof setTimeout>) => clearTimeout(timer),
    );

    const pending = waitForInlineAgentLiveTarget({
      find: () => target,
      observe(onMutation) {
        notifyMutation = onMutation;
        return stopObserving;
      },
      scheduleTimeout: (callback, delayMs) => setTimeout(callback, delayMs),
      clearScheduledTimeout,
      signal: new AbortController().signal,
      timeoutMs: 1500,
    });

    target = { id: "assistant-2" };
    notifyMutation();

    await expect(pending).resolves.toBe(target);
    expect(stopObserving).toHaveBeenCalledOnce();
    expect(clearScheduledTimeout).toHaveBeenCalledOnce();
  });

  it("settles null on timeout or capability abort and always disconnects the observer", async () => {
    vi.useFakeTimers();
    const timedStop = vi.fn();
    const timed = waitForInlineAgentLiveTarget({
      find: () => null,
      observe: () => timedStop,
      scheduleTimeout: (callback, delayMs) => setTimeout(callback, delayMs),
      clearScheduledTimeout: (timer) => clearTimeout(timer),
      signal: new AbortController().signal,
      timeoutMs: 1500,
    });
    await vi.advanceTimersByTimeAsync(1500);
    await expect(timed).resolves.toBeNull();
    expect(timedStop).toHaveBeenCalledOnce();

    const controller = new AbortController();
    const abortedStop = vi.fn();
    const aborted = waitForInlineAgentLiveTarget({
      find: () => null,
      observe: () => abortedStop,
      scheduleTimeout: (callback, delayMs) => setTimeout(callback, delayMs),
      clearScheduledTimeout: (timer) => clearTimeout(timer),
      signal: controller.signal,
      timeoutMs: 1500,
    });
    controller.abort();
    await expect(aborted).resolves.toBeNull();
    expect(abortedStop).toHaveBeenCalledOnce();
  });
});
