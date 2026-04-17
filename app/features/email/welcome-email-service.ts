import ky from 'ky';

const RESEND_API_URL = 'https://api.resend.com/emails';
const EMAIL_FROM = 'Agicash <noreply@emails.agi.cash>';
const EMAIL_SUBJECT = 'Welcome to Agicash';

export async function sendWelcomeEmail(data: {
  id: string;
  email: string | null;
}): Promise<void> {
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
