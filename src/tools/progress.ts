import type { RequestHandlerExtra } from '@modelcontextprotocol/sdk/shared/protocol.js';
import type { ServerNotification, ServerRequest } from '@modelcontextprotocol/sdk/types.js';

const PROGRESS_INTERVAL_MS = 15_000;

type Extra = Pick<
  RequestHandlerExtra<ServerRequest, ServerNotification>,
  '_meta' | 'sendNotification'
>;

// Generations can take minutes. When the client asked for progress, send a heartbeat every 15 s
// so it does not give up; the timer is always cleared.
export async function withProgress<T>(extra: Extra, work: () => Promise<T>): Promise<T> {
  const progressToken = extra._meta?.progressToken;
  let ticks = 0;
  const timer =
    progressToken === undefined
      ? undefined
      : setInterval(() => {
          ticks += 1;
          extra
            .sendNotification({
              method: 'notifications/progress',
              params: {
                progressToken,
                progress: ticks,
                message: `Still generating (${(ticks * PROGRESS_INTERVAL_MS) / 1000}s)`,
              },
            })
            .catch(() => {});
        }, PROGRESS_INTERVAL_MS);
  try {
    return await work();
  } finally {
    clearInterval(timer);
  }
}
