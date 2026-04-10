import ky from 'ky';
import { z } from 'zod';
import type { Route } from './+types/api.welcome-email';

const payloadSchema = z.object({
  id: z.string(),
  email: z.string(),
  firstName: z.string().optional(),
});

function json(body: Record<string, unknown>, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export async function action({ request }: Route.ActionArgs) {
  // Auth
  const authHeader = request.headers.get('Authorization');
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;

  if (!token || token !== process.env.WEBHOOK_SECRET) {
    return json({ error: 'Unauthorized' }, 401);
  }

  // Parse + validate
  const rawBody: unknown = await request.json();
  const parsed = payloadSchema.safeParse(rawBody);

  if (!parsed.success) {
    return json(
      { error: 'Invalid payload', details: parsed.error.flatten() },
      400,
    );
  }

  const { id, email, firstName } = parsed.data;

  // Send via Resend
  try {
    const response = await ky
      .post('https://api.resend.com/emails', {
        headers: {
          Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
          'Idempotency-Key': `welcome-email/${id}`,
        },
        json: {
          from: 'Agicash <noreply@emails.agi.cash>',
          to: [email],
          subject: 'Welcome to Agicash',
          template: {
            id: process.env.RESEND_WELCOME_TEMPLATE_ID,
            variables: {
              firstName: firstName ?? 'there',
              email,
            },
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
