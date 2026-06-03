import * as Sentry from '@sentry/react-router';
import type { Route } from './+types/api.logs';

const SENTRY_HOST = import.meta.env.VITE_SENTRY_HOST ?? '';
if (!SENTRY_HOST) {
  throw new Error('VITE_SENTRY_HOST is not set');
}

const SENTRY_PROJECT_ID = import.meta.env.VITE_SENTRY_PROJECT_ID ?? '';
if (!SENTRY_PROJECT_ID) {
  throw new Error('VITE_SENTRY_PROJECT_ID is not set');
}

const upstream_sentry_url = `https://${SENTRY_HOST}/api/${SENTRY_PROJECT_ID}/envelope/`;

const invalidRequest = (message = 'Invalid request') => {
  return new Response(JSON.stringify({ error: message }), {
    status: 400,
    headers: { 'Content-Type': 'application/json' },
  });
};

export async function action({ request }: Route.ActionArgs) {
  try {
    if (request.method !== 'POST') {
      return new Response(JSON.stringify({ error: 'Invalid method' }), {
        status: 405,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const envelopeBytes = await request.arrayBuffer();
    const envelope = new TextDecoder().decode(envelopeBytes);
    const piece = envelope.split('\n')[0];

    if (!piece) {
      return invalidRequest();
    }

    const header = JSON.parse(piece);
    const dsn = new URL(header.dsn);

    if (!dsn) {
      return invalidRequest();
    }

    const project_id = dsn.pathname?.replace('/', '');

    if (dsn.hostname !== SENTRY_HOST) {
      return invalidRequest(`Invalid sentry hostname: ${dsn.hostname}`);
    }
    if (project_id !== SENTRY_PROJECT_ID) {
      return invalidRequest(`Invalid sentry project id: ${project_id}`);
    }

    await fetch(upstream_sentry_url, {
      method: 'POST',
      body: envelopeBytes,
    });

    return new Response(JSON.stringify({}), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (e) {
    console.error('Error tunneling to sentry', { cause: e });

    Sentry.captureException(e);

    return new Response(
      JSON.stringify({ error: 'Error tunneling to sentry' }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      },
    );
  }
}
