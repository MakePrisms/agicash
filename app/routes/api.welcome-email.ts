import ky from 'ky';
import { z } from 'zod';
import type { Route } from './+types/api.welcome-email';

const RESEND_API_URL = 'https://api.resend.com/emails';
const EMAIL_FROM = 'Agicash <noreply@emails.agi.cash>';
const EMAIL_SUBJECT = 'Welcome to Agicash';

const payloadSchema = z.object({
  id: z.string(),
  email: z.string().email(),
});

function json(body: Record<string, unknown>, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export async function action({ request }: Route.ActionArgs) {
  const resendApiKey = process.env.RESEND_API_KEY;
  const resendWelcomeTemplateId = process.env.RESEND_WELCOME_TEMPLATE_ID;

  if (!resendApiKey || !resendWelcomeTemplateId) {
    console.error(
      'Missing env vars: RESEND_API_KEY or RESEND_WELCOME_TEMPLATE_ID',
    );
    return json({ error: 'Server misconfigured' }, 500);
  }

  const authHeader = request.headers.get('Authorization');
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;

  if (!token || token !== process.env.WEBHOOK_SECRET) {
    return json({ error: 'Unauthorized' }, 401);
  }

  const parsed = payloadSchema.safeParse(await request.json());

  if (!parsed.success) {
    return json(
      { error: 'Invalid payload', details: parsed.error.flatten() },
      400,
    );
  }

  const { id, email } = parsed.data;

  try {
    const response = await ky
      .post(RESEND_API_URL, {
        headers: {
          Authorization: `Bearer ${resendApiKey}`,
          'Idempotency-Key': `welcome-email/${id}`,
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

    return json({ success: true, data: response }, 200);
  } catch (error) {
    console.error('Failed to send welcome email', { userId: id, error });
    return json({ error: 'Failed to send email' }, 500);
  }
}
