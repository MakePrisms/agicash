import { timingSafeEqual } from 'node:crypto';
import { hmac } from '@noble/hashes/hmac';
import { sha256 } from '@noble/hashes/sha2';
import { bytesToHex } from '@noble/hashes/utils';
import ky from 'ky';
import { z } from 'zod';
import type { AgicashDbUser } from '~/features/agicash-db/database';
import { safeJsonParse } from '~/lib/json';
import type { Route } from './+types/api.events';

const RESEND_API_URL = 'https://api.resend.com/emails';
const EMAIL_FROM = 'Agicash <noreply@emails.agi.cash>';
const EMAIL_SUBJECT = 'Welcome to Agicash';
const MAX_SIGNATURE_AGE_SECONDS = 300;
const KNOWN_EVENT_TYPES: Set<string> = new Set([
  'user.created',
  'user.upgraded',
]);

// -- Schemas --

const userDataSchema = z.object({
  id: z.string().uuid(),
  email: z.string().nullable(),
}) satisfies z.ZodType<Pick<AgicashDbUser, 'id' | 'email'>>;

type UserData = Pick<AgicashDbUser, 'id' | 'email'>;

const eventBase = {
  id: z.string().uuid(),
  time: z.iso.datetime(),
};

const eventSchema = z.discriminatedUnion('type', [
  z.object({
    ...eventBase,
    type: z.literal('user.created'),
    data: userDataSchema,
  }),
  z.object({
    ...eventBase,
    type: z.literal('user.upgraded'),
    data: userDataSchema,
  }),
]);

type AppEvent = z.infer<typeof eventSchema>;

// -- Helpers --

function json(body: Record<string, unknown>, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function extractEventType(body: unknown): string | null {
  if (!body || typeof body !== 'object' || !('type' in body)) {
    return null;
  }

  return typeof body.type === 'string' ? body.type : null;
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

async function handleWelcomeEmail(data: UserData): Promise<void> {
  if (!data.email) {
    console.info('events webhook skipped welcome email', {
      code: 'no_email',
      message: 'User has no email address',
    });
    return;
  }

  const { id: userId, email } = data;

  const resendApiKey = process.env.RESEND_API_KEY;
  const resendWelcomeTemplateId = process.env.RESEND_WELCOME_TEMPLATE_ID;

  if (!resendApiKey || !resendWelcomeTemplateId) {
    console.error('events webhook failed welcome email', {
      code: 'server_misconfigured',
      message: 'Missing RESEND_API_KEY or RESEND_WELCOME_TEMPLATE_ID',
      userId,
    });
    return;
  }

  try {
    await ky
      .post(RESEND_API_URL, {
        headers: {
          Authorization: `Bearer ${resendApiKey}`,
          'Idempotency-Key': `welcome-email/${userId}`,
        },
        json: {
          from: EMAIL_FROM,
          to: [email],
          subject: EMAIL_SUBJECT,
          template: {
            id: resendWelcomeTemplateId,
            variables: { email },
          },
        },
        retry: {
          limit: 2,
          statusCodes: [408, 429, 500, 502, 503, 504],
          backoffLimit: 3000,
        },
        timeout: 10_000,
      })
      .json();

    console.info('events webhook sent welcome email', {
      code: 'email_sent',
      userId,
    });
  } catch (error) {
    console.error('events webhook failed welcome email', {
      code: 'email_send_failed',
      userId,
      message: error instanceof Error ? error.message : String(error),
      error,
    });
  }
}

function getHandlers(event: AppEvent): EventHandler[] {
  switch (event.type) {
    case 'user.created':
    case 'user.upgraded':
      return [
        { name: 'welcome-email', run: () => handleWelcomeEmail(event.data) },
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
    const type = extractEventType(jsonResult.data);

    // Unknown event types return 200 for forward compatibility —
    // the DB may emit new types before handlers are added
    if (type && !KNOWN_EVENT_TYPES.has(type)) {
      console.info('events webhook ignored unknown event type', { type });
      return json({ ok: true, ignored: true, type }, 200);
    }

    console.error('events webhook invalid event payload', {
      error: z.flattenError(parsed.error),
    });
    return json({ error: 'Invalid event' }, 400);
  }

  const event = parsed.data;
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
