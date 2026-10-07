import { afterEach, describe, expect, it, vi } from 'vitest';
import { withProgress } from '../../src/tools/progress.js';

function fakeExtra(progressToken?: string | number) {
  const sendNotification = vi.fn<(notification: unknown) => Promise<void>>(async () => {});
  return {
    extra: { _meta: progressToken === undefined ? undefined : { progressToken }, sendNotification },
    sendNotification,
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('withProgress', () => {
  it('emits a progress notification every 15 s and clears the timer afterwards', async () => {
    vi.useFakeTimers();
    const { extra, sendNotification } = fakeExtra('tok');
    let finish!: () => void;
    const done = withProgress(
      extra as never,
      () => new Promise<string>((resolve) => (finish = () => resolve('ok'))),
    );
    expect(vi.getTimerCount()).toBe(1);
    await vi.advanceTimersByTimeAsync(15_000);
    expect(sendNotification).toHaveBeenCalledTimes(1);
    expect(sendNotification).toHaveBeenCalledWith({
      method: 'notifications/progress',
      params: { progressToken: 'tok', progress: 1, message: 'Still generating (15s)' },
    });
    await vi.advanceTimersByTimeAsync(15_000);
    expect(sendNotification).toHaveBeenCalledTimes(2);
    finish();
    expect(await done).toBe('ok');
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(sendNotification).toHaveBeenCalledTimes(2);
  });

  it('clears the timer when the work throws', async () => {
    vi.useFakeTimers();
    const { extra } = fakeExtra(7);
    await expect(
      withProgress(extra as never, async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('starts no timer without a progress token', async () => {
    vi.useFakeTimers();
    const { extra, sendNotification } = fakeExtra();
    await withProgress(extra as never, async () => {
      expect(vi.getTimerCount()).toBe(0);
    });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(sendNotification).not.toHaveBeenCalled();
  });
});
