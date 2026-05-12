import { SimplePool } from 'nostr-tools';
import type { VerifiedEvent } from 'nostr-tools/pure';

export type PublishZapReceiptResult = {
  ok: boolean;
  accepted: string[];
  rejected: { relay: string; reason: string }[];
};

/**
 * Publishes a signed kind:9735 zap receipt to the given relays with a
 * mandatory per-relay timeout. Closes pool connections after settle since
 * we run in serverless contexts with no connection reuse.
 *
 * Resolves with which relays accepted and which timed out or rejected.
 * Always returns - never throws on relay failures.
 */
export async function publishZapReceipt(
  receipt: VerifiedEvent,
  relays: string[],
  timeoutMs = 3000,
): Promise<PublishZapReceiptResult> {
  if (relays.length === 0) {
    return { ok: false, accepted: [], rejected: [] };
  }

  const pool = new SimplePool();
  const accepted: string[] = [];
  const rejected: { relay: string; reason: string }[] = [];

  try {
    const publishPromises = pool.publish(relays, receipt);

    const settled = await Promise.allSettled(
      publishPromises.map((p, i) => {
        const relay = relays[i] ?? 'unknown';
        return Promise.race<string>([
          p,
          new Promise<string>((_, reject) =>
            setTimeout(
              () => reject(new Error(`relay publish timed out after ${timeoutMs}ms`)),
              timeoutMs,
            ),
          ),
        ])
          .then((value) => ({ relay, value }))
          .catch((err: unknown) => {
            throw { relay, reason: err instanceof Error ? err.message : String(err) };
          });
      }),
    );

    for (const result of settled) {
      if (result.status === 'fulfilled') {
        accepted.push(result.value.relay);
      } else {
        const reason = result.reason as { relay: string; reason: string };
        rejected.push({ relay: reason.relay, reason: reason.reason });
      }
    }
  } finally {
    try {
      pool.close(relays);
    } catch (err) {
      console.warn('zap publisher: pool.close failed', { cause: err });
    }
  }

  return { ok: accepted.length > 0, accepted, rejected };
}
