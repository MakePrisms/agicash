import { z } from 'zod';
import { unsubscribeContact } from '~/features/email/email-service.server';
import type { Route } from './+types/api.unsubscribe';

const querySchema = z.object({
  email: z
    .string()
    .min(1)
    .transform((val) => {
      try {
        return atob(val);
      } catch {
        return '';
      }
    })
    .pipe(z.string().email()),
});

function htmlResponse(body: string, status = 200) {
  return new Response(body, {
    status,
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  });
}

function renderPage(heading: string, message: string) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${heading} - Agicash</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: #fff;
      color: #1a1a1a;
      display: flex;
      justify-content: center;
      align-items: center;
      min-height: 100vh;
      padding: 24px;
    }
    .container {
      text-align: center;
      max-width: 420px;
    }
    .logo {
      width: 64px;
      height: 64px;
      margin-bottom: 24px;
    }
    h1 {
      font-size: 24px;
      font-weight: 600;
      margin-bottom: 12px;
    }
    p {
      font-size: 16px;
      color: #555;
      line-height: 1.5;
      margin-bottom: 24px;
    }
    a {
      color: #6366f1;
      text-decoration: none;
      font-weight: 500;
    }
    a:hover { text-decoration: underline; }
  </style>
</head>
<body>
  <div class="container">
    <img src="/agicash-logo.png" alt="Agicash" class="logo" />
    <h1>${heading}</h1>
    <p>${message}</p>
    <a href="https://agi.cash">Go to agi.cash</a>
  </div>
</body>
</html>`;
}

export async function loader({ request }: Route.LoaderArgs) {
  const url = new URL(request.url);
  const params = Object.fromEntries(url.searchParams);
  const result = querySchema.safeParse(params);

  if (!result.success) {
    return htmlResponse(
      renderPage('Invalid Request', 'The unsubscribe link appears to be invalid.'),
      400,
    );
  }

  try {
    await unsubscribeContact(result.data.email);
  } catch (error) {
    console.error('Failed to unsubscribe contact', { cause: error });
    return htmlResponse(
      renderPage(
        'Something went wrong',
        'We could not process your request. Please try again later.',
      ),
      500,
    );
  }

  return htmlResponse(
    renderPage(
      "You've been unsubscribed",
      "You won't receive any more emails from Agicash.",
    ),
  );
}
