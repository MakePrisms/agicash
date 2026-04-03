import ky from 'ky';

const RESEND_API_BASE = 'https://api.resend.com';
const FROM_ADDRESS = 'Agicash <noreply@emails.agi.cash>';

function getRequiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is not set`);
  }
  return value;
}

function getResendClient() {
  return ky.create({
    prefixUrl: RESEND_API_BASE,
    headers: {
      Authorization: `Bearer ${getRequiredEnv('RESEND_API_KEY')}`,
    },
  });
}

type SignupMethod = 'email' | 'google' | 'guest';

type NewSignupParams = {
  email: string;
  firstName?: string;
  signupMethod: SignupMethod;
};

async function createContact(email: string, firstName?: string) {
  const resend = getResendClient();
  const audienceId = getRequiredEnv('RESEND_AUDIENCE_ID');
  const body: Record<string, string> = { email };
  if (firstName) {
    body.first_name = firstName;
  }

  await resend.post(`audiences/${audienceId}/contacts`, { json: body });
}

const APP_URL = 'https://agi.cash';

async function sendWelcomeEmail(email: string, firstName?: string) {
  const resend = getResendClient();
  const templateId = getRequiredEnv('RESEND_WELCOME_TEMPLATE_ID');
  const unsubscribeUrl = `${APP_URL}/api/unsubscribe?email=${btoa(email)}`;

  await resend.post('emails', {
    json: {
      from: FROM_ADDRESS,
      to: [email],
      subject: 'Welcome to Agicash',
      template: {
        id: templateId,
        variables: {
          firstName: firstName ?? 'there',
          email,
          unsubscribeUrl,
        },
      },
    },
  });
}

export async function unsubscribeContact(email: string): Promise<void> {
  const resend = getResendClient();
  const audienceId = getRequiredEnv('RESEND_AUDIENCE_ID');

  await resend.patch(`audiences/${audienceId}/contacts/${email}`, {
    json: { unsubscribed: true },
  });
}

export async function handleNewSignup(params: NewSignupParams): Promise<void> {
  if (params.signupMethod === 'guest') {
    return;
  }

  try {
    await createContact(params.email, params.firstName);
  } catch (error) {
    console.error('Failed to create Resend contact', { cause: error });
  }

  try {
    await sendWelcomeEmail(params.email, params.firstName);
  } catch (error) {
    console.error('Failed to send welcome email', { cause: error });
  }
}
