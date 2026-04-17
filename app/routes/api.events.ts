import { timingSafeEqual } from 'node:crypto';
import { hmac } from '@noble/hashes/hmac';
import { sha256 } from '@noble/hashes/sha2';
import { bytesToHex } from '@noble/hashes/utils';
import { z } from 'zod';
import type { AgicashDbUser } from '~/features/agicash-db/database';
import { sendWelcomeEmail } from '~/features/email/welcome-email-service';
import { safeJsonParse } from '~/lib/json';
import type { Route } from './+types/api.events';

const MAX_SIGNATURE_AGE_SECONDS = 300;

// -- Schemas --

const userDataSchema = z.object({
  id: z.string().uuid(),
  email: z.string().nullable(),
}) satisfies z.ZodType<Pick<AgicashDbUser, 'id' | 'email'>>;

const eventSchema = z.intersection(
  z.object({
    id: z.uuid(),
    time: z.iso.datetime(),
  }),
  z.union([
    z.discriminatedUnion('type', [
      z.object({
        type: z.literal('user.created'),
        data: userDataSchema,
      }),
      z.object({
        type: z.literal('user.upgraded'),
        data: userDataSchema,
      }),
    ]),
    // Fallback for forward compatibility with unknown event types.
    // Refine rejects known types so a known type with malformed data fails
    // the whole parse rather than falling through here as `data: unknown`.
    z
      .object({ type: z.string(), data: z.unknown() })
      .refine((v) => v.type !== 'user.created' && v.type !== 'user.upgraded', {
        message: 'known event type with invalid data',
      }),
  ]),
);

type AppEvent = z.infer<typeof eventSchema>;

// -- Helpers --

function json(body: Record<string, unknown>, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function verifySignature(
  rawBody: string,
  signatureHeader: string,
  secret: string,
): { valid: boolean; reason?: string } {
  const parts = Object.fromEntries(
    signatureHeader.split(',').map((part) => {
      const [key, ...rest] = part.trim().split('=');
      return [key, rest.join('=')];
    }),
  );

  const timestamp = parts.t;
  const signature = parts.v1;

  if (!timestamp || !signature) {
    return { valid: false, reason: 'Missing timestamp or signature' };
  }

  const age = Math.floor(Date.now() / 1000) - Number.parseInt(timestamp, 10);
  if (Number.isNaN(age) || Math.abs(age) > MAX_SIGNATURE_AGE_SECONDS) {
    return { valid: false, reason: 'Signature expired' };
  }

  const expected = bytesToHex(hmac(sha256, secret, `${timestamp}.${rawBody}`));
  const expectedBuffer = Buffer.from(expected, 'utf8');
  const signatureBuffer = Buffer.from(signature, 'utf8');

  if (expectedBuffer.length !== signatureBuffer.length) {
    return { valid: false, reason: 'Invalid signature' };
  }

  if (!timingSafeEqual(expectedBuffer, signatureBuffer)) {
    return { valid: false, reason: 'Invalid signature' };
  }

  return { valid: true };
}

// -- Handlers --

type EventHandler = {
  name: string;
  run: () => Promise<void>;
};

type KnownEvent = Extract<AppEvent, { type: 'user.created' | 'user.upgraded' }>;

function isKnownEvent(event: AppEvent): event is KnownEvent {
  return event.type === 'user.created' || event.type === 'user.upgraded';
}

function getHandlers(event: KnownEvent): EventHandler[] {
  switch (event.type) {
    case 'user.created':
    case 'user.upgraded':
      return [
        { name: 'welcome-email', run: () => sendWelcomeEmail(event.data) },
      ];
  }
}

// -- Action --

export async function action({ request }: Route.ActionArgs) {
  const webhookSecret = process.env.WEBHOOK_SECRET;
  if (!webhookSecret) {
    console.error('events webhook missing WEBHOOK_SECRET env var');
    return json({ error: 'Server misconfigured' }, 500);
  }

  const signatureHeader = request.headers.get('X-Webhook-Signature');
  if (!signatureHeader) {
    return json({ error: 'Missing signature' }, 401);
  }

  const rawBody = await request.text();

  const { valid, reason } = verifySignature(
    rawBody,
    signatureHeader,
    webhookSecret,
  );
  if (!valid) {
    return json({ error: reason ?? 'Unauthorized' }, 401);
  }

  const jsonResult = safeJsonParse(rawBody);
  if (!jsonResult.success) {
    return json({ error: 'Invalid JSON' }, 400);
  }

  const parsed = eventSchema.safeParse(jsonResult.data);
  if (!parsed.success) {
    console.warn('events webhook invalid event payload', {
      error: z.flattenError(parsed.error),
    });
    return json({ error: 'Invalid event' }, 400);
  }

  const event = parsed.data;

  // Unknown event types return 200 for forward compatibility —
  // the DB may emit new types before handlers are added
  if (!isKnownEvent(event)) {
    console.info('events webhook ignored unknown event type', {
      type: event.type,
    });
    return json({ ok: true, ignored: true, type: event.type }, 200);
  }

  const handlers = getHandlers(event);

  const settled = await Promise.allSettled(
    handlers.map((handler) => handler.run()),
  );
  const failedHandlers = settled.flatMap((result, index) =>
    result.status === 'rejected'
      ? [
          {
            handler: handlers[index]?.name ?? 'unknown',
            message: String(result.reason),
          },
        ]
      : [],
  );

  if (failedHandlers.length > 0) {
    console.error('events webhook handler execution failures', {
      eventId: event.id,
      eventType: event.type,
      failures: failedHandlers,
    });
  }

  console.info('events webhook handled event', {
    eventId: event.id,
    eventType: event.type,
    handlerCount: handlers.length,
    failedHandlerCount: failedHandlers.length,
  });

  return json({ ok: true }, 200);
}
