import { z } from 'zod';
import { handleNewSignup } from '~/features/email/email-service.server';
import type { Route } from './+types/api.welcome-email';

const requestSchema = z.object({
  email: z.string().email(),
  firstName: z.string().optional(),
  signupMethod: z.enum(['email', 'google', 'guest']),
});

export async function action({ request }: Route.ActionArgs) {
  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const body = await request.json();
  const result = requestSchema.safeParse(body);

  if (!result.success) {
    return new Response(
      JSON.stringify({ error: 'Invalid request', details: result.error.flatten() }),
      {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      },
    );
  }

  await handleNewSignup(result.data);

  return new Response(JSON.stringify({ success: true }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}
